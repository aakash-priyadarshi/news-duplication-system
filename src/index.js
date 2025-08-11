#!/usr/bin/env node

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { RateLimiterMemory } = require('rate-limiter-flexible');

// Internal imports
const logger = require('./utils/logger');
const config = require('./config/config');
const DatabaseManager = require('./services/DatabaseManager');
const NewsProcessor = require('./services/NewsProcessor');
const DeduplicationEngine = require('./services/DeduplicationEngine');
const AlertManager = require('./services/AlertManager');
const HealthChecker = require('./utils/healthcheck');

// Route imports
const newsRoutes = require('./routes/news');
const alertRoutes = require('./routes/alerts');
const healthRoutes = require('./routes/health');
const metricsRoutes = require('./routes/metrics');

class NewsDeduplicationApp {
  constructor() {
    this.app = express();
    this.server = null;
    this.isShuttingDown = false;
    
    // Core services
    this.dbManager = new DatabaseManager();
    this.newsProcessor = new NewsProcessor();
    this.deduplicationEngine = new DeduplicationEngine();
    this.alertManager = new AlertManager();
    this.healthChecker = new HealthChecker();
    
    // Rate limiter
    this.rateLimiter = new RateLimiterMemory({
      keyBy: (req) => req.ip,
      points: config.api.rateLimitMaxRequests,
      duration: config.api.rateLimitWindowMs / 1000,
    });
  }

  async initialize() {
    try {
      logger.info('🚀 Initializing News Deduplication System...');
      
      // Initialize database connections
      await this.dbManager.connect();
      logger.info('✅ Database connections established');
      
      // Initialize core services
      await this.initializeServices();
      logger.info('✅ Core services initialized');
      
      // Make services available to routes
      this.app.locals.services = {
        dbManager: this.dbManager,
        newsProcessor: this.newsProcessor,
        deduplicationEngine: this.deduplicationEngine,
        alertManager: this.alertManager,
        healthChecker: this.healthChecker
      };
      
      // Setup Express middleware
      this.setupMiddleware();
      logger.info('✅ Express middleware configured');
      
      // Setup routes
      this.setupRoutes();
      logger.info('✅ API routes configured');
      
      // Setup error handling
      this.setupErrorHandling();
      logger.info('✅ Error handling configured');
      
      // Start background processes
      await this.startBackgroundProcesses();
      logger.info('✅ Background processes started');
      
      logger.info('🎉 News Deduplication System initialized successfully!');
      
    } catch (error) {
      logger.error('❌ Failed to initialize application:', error);
      console.error('Detailed error:', error.stack);
      throw error;
    }
  }

  async initializeServices() {
    // Initialize services with proper dependency injection
    await this.newsProcessor.initialize(this.dbManager);
    await this.deduplicationEngine.initialize(this.dbManager);
    await this.alertManager.initialize(this.dbManager);
    
    // Set up service interconnections
    this.newsProcessor.on('articleProcessed', (article) => {
      this.deduplicationEngine.processArticle(article);
    });
    
    this.deduplicationEngine.on('uniqueArticleDetected', (article) => {
      this.alertManager.processAlert(article);
    });
    
    this.alertManager.on('alertSent', (alertInfo) => {
      logger.info(`📢 Alert sent: ${alertInfo.title} to ${alertInfo.channels.join(', ')}`);
    });
  }

  setupMiddleware() {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
    }));
    
    // CORS configuration
    this.app.use(cors({
      origin: process.env.NODE_ENV === 'production' 
        ? config.api.allowedOrigins 
        : true,
      credentials: true,
    }));
    
    // Rate limiting
    this.app.use(async (req, res, next) => {
      try {
        await this.rateLimiter.consume(req.ip);
        next();
      } catch (rejRes) {
        const secs = Math.round(rejRes.msBeforeNext / 1000) || 1;
        res.set('Retry-After', String(secs));
        res.status(429).json({
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Try again in ${secs} seconds.`,
        });
      }
    });
    
    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    
    // Request logging
    this.app.use((req, res, next) => {
      logger.info(`📥 ${req.method} ${req.path} - ${req.ip}`);
      next();
    });
    
    // Request timing
    this.app.use((req, res, next) => {
      req.startTime = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - req.startTime;
        logger.info(`📤 ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
      });
      next();
    });
  }

  setupRoutes() {
    // API routes
    this.app.use('/api/news', newsRoutes);
    this.app.use('/api/alerts', alertRoutes);
    this.app.use('/api/health', healthRoutes);
    this.app.use('/api/metrics', metricsRoutes);
    
    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        name: 'News Deduplication System',
        version: process.env.npm_package_version || '1.0.0',
        status: 'running',
        timestamp: new Date().toISOString(),
        endpoints: {
          health: '/api/health',
          metrics: '/api/metrics',
          news: '/api/news',
          alerts: '/api/alerts',
        },
      });
    });
    
    // Health check endpoint (alternative)
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      });
    });
    
    // 404 handler - FIXED: Use a proper route pattern instead of '*'
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: `The endpoint ${req.method} ${req.originalUrl} was not found.`,
        timestamp: new Date().toISOString(),
      });
    });
  }

  setupErrorHandling() {
    // Global error handler
    this.app.use((error, req, res, next) => {
      logger.error('🚨 Unhandled error:', error);
      
      // Don't leak error details in production
      const isDevelopment = process.env.NODE_ENV === 'development';
      
      res.status(error.status || 500).json({
        error: error.name || 'Internal Server Error',
        message: error.message || 'Something went wrong',
        ...(isDevelopment && { stack: error.stack }),
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] || 'unknown',
      });
    });
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('💥 Uncaught Exception:', error);
      this.gracefulShutdown('uncaughtException');
    });
    
    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
      this.gracefulShutdown('unhandledRejection');
    });
    
    // Handle termination signals
    process.on('SIGTERM', () => {
      logger.info('📱 SIGTERM received, initiating graceful shutdown...');
      this.gracefulShutdown('SIGTERM');
    });
    
    process.on('SIGINT', () => {
      logger.info('📱 SIGINT received, initiating graceful shutdown...');
      this.gracefulShutdown('SIGINT');
    });
  }

  async startBackgroundProcesses() {
    // Start RSS feed monitoring
    await this.newsProcessor.startFeedMonitoring();
    
    // Start deduplication engine
    await this.deduplicationEngine.startProcessing();
    
    // Start health monitoring
    this.healthChecker.startMonitoring({
      dbManager: this.dbManager,
      newsProcessor: this.newsProcessor,
      deduplicationEngine: this.deduplicationEngine,
      alertManager: this.alertManager,
    });
  }

  async start() {
    try {
      await this.initialize();
      
      const port = config.server.port;
      const host = config.server.host;
      
      this.server = this.app.listen(port, host, () => {
        logger.info(`🌟 News Deduplication System running at http://${host}:${port}`);
        logger.info(`📋 Environment: ${process.env.NODE_ENV || 'development'}`);
        logger.info(`🏥 Health check: http://${host}:${port}/api/health`);
        logger.info(`📊 Metrics: http://${host}:${port}/api/metrics`);
        logger.info('🚀 System is ready to process news feeds!');
      });
      
      // Handle server errors
      this.server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          logger.error(`❌ Port ${port} is already in use`);
        } else {
          logger.error('❌ Server error:', error);
        }
        process.exit(1);
      });
      
    } catch (error) {
      logger.error('❌ Failed to start server:', error);
      process.exit(1);
    }
  }

  async gracefulShutdown(signal) {
    if (this.isShuttingDown) {
      logger.info('🔄 Shutdown already in progress...');
      return;
    }
    
    this.isShuttingDown = true;
    logger.info(`🛑 Graceful shutdown initiated (${signal})...`);
    
    try {
      // Stop accepting new requests
      if (this.server) {
        this.server.close(() => {
          logger.info('✅ HTTP server closed');
        });
      }
      
      // Stop background processes
      await this.newsProcessor.stop();
      await this.deduplicationEngine.stop();
      await this.alertManager.stop();
      this.healthChecker.stopMonitoring();
      
      // Close database connections
      await this.dbManager.disconnect();
      
      logger.info('✅ Graceful shutdown completed');
      process.exit(0);
      
    } catch (error) {
      logger.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  }
}

// Start the application
if (require.main === module) {
  const app = new NewsDeduplicationApp();
  app.start().catch((error) => {
    logger.error('💥 Failed to start application:', error);
    process.exit(1);
  });
}

module.exports = NewsDeduplicationApp;