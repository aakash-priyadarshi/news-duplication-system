const path = require('path');
const Joi = require('joi');

// Configuration schema for validation
const configSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3000),
  HOST: Joi.string().hostname().default('localhost'),
  
  // Database
  MONGODB_URI: Joi.string().uri().required(),
  REDIS_URL: Joi.string().uri().required(),
  
  // API Keys
  OPENAI_API_KEY: Joi.string().optional(),
  ANTHROPIC_API_KEY: Joi.string().optional(),
  COHERE_API_KEY: Joi.string().optional(),
  
  // n8n Integration
  N8N_WEBHOOK_URL: Joi.string().uri().optional(),
  N8N_API_KEY: Joi.string().optional(),
  N8N_BASE_URL: Joi.string().uri().optional(),
  
  // Deduplication Settings
  SIMILARITY_THRESHOLD: Joi.number().min(0).max(1).default(0.85),
  TIME_WINDOW_HOURS: Joi.number().min(1).max(168).default(24),
  CONTENT_FINGERPRINT_ALGO: Joi.string().valid('sha256', 'md5', 'sha1').default('sha256'),
  SEMANTIC_MODEL: Joi.string().default('sentence-transformers/all-MiniLM-L6-v2'),
  
  // Performance
  MAX_CONCURRENT_FEEDS: Joi.number().min(1).max(50).default(10),
  BATCH_SIZE: Joi.number().min(1).max(1000).default(50),
  VECTOR_DIMENSION: Joi.number().default(384),
  
  // Security
  JWT_SECRET: Joi.string().min(32).required(),
  API_RATE_LIMIT_WINDOW_MS: Joi.number().default(900000),
  API_RATE_LIMIT_MAX_REQUESTS: Joi.number().default(100),
  
  // Logging
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
  LOG_FILE_PATH: Joi.string().default('logs/app.log'),
  
  // Alerts
  ALERT_COOLDOWN_MINUTES: Joi.number().min(1).default(5),
  MAX_ALERTS_PER_HOUR: Joi.number().min(1).default(20),
  ENABLE_EMAIL_ALERTS: Joi.boolean().default(false),
  ENABLE_SLACK_ALERTS: Joi.boolean().default(false),
  ENABLE_WEBHOOK_ALERTS: Joi.boolean().default(true),
  
  // Monitoring
  ENABLE_METRICS: Joi.boolean().default(true),
  METRICS_PORT: Joi.number().port().default(9090),
  HEALTH_CHECK_INTERVAL_MS: Joi.number().default(30000),
}).unknown(true);

class ConfigManager {
  constructor() {
    this.config = this.loadAndValidateConfig();
  }

  loadAndValidateConfig() {
    // Validate environment variables
    const { error, value: envVars } = configSchema.validate(process.env);
    
    if (error) {
      throw new Error(`Configuration validation error: ${error.message}`);
    }

    // Build configuration object
    const config = {
      env: envVars.NODE_ENV,
      
      server: {
        port: envVars.PORT,
        host: envVars.HOST,
      },
      
      database: {
        mongodb: {
          uri: envVars.MONGODB_URI,
          options: {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            bufferMaxEntries: 0,
            bufferCommands: false,
          },
        },
        redis: {
          url: envVars.REDIS_URL,
          options: {
            maxRetriesPerRequest: 3,
            retryDelayOnFailover: 100,
            enableOfflineQueue: false,
            lazyConnect: true,
          },
        },
      },
      
      ai: {
        openai: {
          apiKey: envVars.OPENAI_API_KEY,
          model: 'gpt-3.5-turbo',
          maxTokens: 1000,
          temperature: 0.1,
        },
        anthropic: {
          apiKey: envVars.ANTHROPIC_API_KEY,
          model: 'claude-3-haiku-20240307',
          maxTokens: 1000,
        },
        cohere: {
          apiKey: envVars.COHERE_API_KEY,
          model: 'embed-english-v3.0',
        },
      },
      
      n8n: {
        webhookUrl: envVars.N8N_WEBHOOK_URL,
        apiKey: envVars.N8N_API_KEY,
        baseUrl: envVars.N8N_BASE_URL,
      },
      
      deduplication: {
        similarityThreshold: envVars.SIMILARITY_THRESHOLD,
        timeWindowHours: envVars.TIME_WINDOW_HOURS,
        contentFingerprintAlgo: envVars.CONTENT_FINGERPRINT_ALGO,
        semanticModel: envVars.SEMANTIC_MODEL,
        vectorDimension: envVars.VECTOR_DIMENSION,
        
        // Advanced settings
        titleWeight: 0.4,
        contentWeight: 0.4,
        entityWeight: 0.2,
        
        // Clustering parameters
        clusteringMethod: 'dbscan',
        minSamples: 2,
        eps: 0.3,
        
        // Content processing
        minContentLength: 100,
        maxContentLength: 50000,
        stopWords: ['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'],
      },
      
      performance: {
        maxConcurrentFeeds: envVars.MAX_CONCURRENT_FEEDS,
        batchSize: envVars.BATCH_SIZE,
        
        // Caching
        cacheSettings: {
          articleTtl: 86400, // 24 hours
          feedTtl: 3600,     // 1 hour
          vectorTtl: 604800, // 7 days
        },
        
        // Memory management
        maxMemoryUsage: '1GB',
        gcInterval: 300000, // 5 minutes
      },
      
      security: {
        jwtSecret: envVars.JWT_SECRET,
        jwtExpiresIn: '24h',
        
        // Content sanitization
        allowedHtmlTags: ['p', 'br', 'strong', 'em', 'a', 'ul', 'ol', 'li'],
        maxFieldLength: 10000,
      },
      
      api: {
        rateLimitWindowMs: envVars.API_RATE_LIMIT_WINDOW_MS,
        rateLimitMaxRequests: envVars.API_RATE_LIMIT_MAX_REQUESTS,
        allowedOrigins: envVars.NODE_ENV === 'production' 
          ? ['https://your-dashboard.com'] 
          : ['http://localhost:3000', 'http://localhost:3001'],
        
        // Request timeouts
        timeoutMs: 30000,
        keepAliveTimeout: 5000,
        headersTimeout: 6000,
      },
      
      feeds: {
        configFile: envVars.RSS_FEEDS_CONFIG_FILE || 'config/rss-feeds.json',
        refreshIntervalMs: 300000, // 5 minutes
        timeoutMs: 30000,
        retryAttempts: 3,
        retryDelayMs: 1000,
        
        // User agent for RSS requests
        userAgent: 'News-Deduplication-Bot/1.0 (+https://your-domain.com/bot)',
        
        // Content extraction
        extractFullContent: true,
        followRedirects: true,
        maxRedirects: 3,
      },
      
      logging: {
        level: envVars.LOG_LEVEL,
        file: envVars.LOG_FILE_PATH,
        maxFiles: 5,
        maxSize: '10m',
        
        // Structured logging
        format: envVars.NODE_ENV === 'production' ? 'json' : 'simple',
        
        // Log retention
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
      },
      
      alerts: {
        cooldownMinutes: envVars.ALERT_COOLDOWN_MINUTES,
        maxAlertsPerHour: envVars.MAX_ALERTS_PER_HOUR,
        
        channels: {
          email: {
            enabled: envVars.ENABLE_EMAIL_ALERTS,
            from: 'alerts@your-domain.com',
            smtp: {
              host: process.env.SMTP_HOST,
              port: process.env.SMTP_PORT || 587,
              secure: false,
              auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
              },
            },
          },
          slack: {
            enabled: envVars.ENABLE_SLACK_ALERTS,
            webhookUrl: process.env.SLACK_WEBHOOK_URL,
            channel: process.env.SLACK_CHANNEL || '#sales-intelligence',
          },
          webhook: {
            enabled: envVars.ENABLE_WEBHOOK_ALERTS,
            url: envVars.N8N_WEBHOOK_URL,
            timeout: 10000,
            retryAttempts: 3,
          },
        },
        
        // Alert formatting
        templates: {
          subject: '[Sales Intelligence] New Alert: {{title}}',
          body: 'New article detected: {{title}}\n\nSource: {{source}}\nPublished: {{publishedAt}}\n\nSummary:\n{{summary}}\n\nRead more: {{url}}',
        },
      },
      
      monitoring: {
        enabled: envVars.ENABLE_METRICS,
        port: envVars.METRICS_PORT,
        healthCheckInterval: envVars.HEALTH_CHECK_INTERVAL_MS,
        
        // Metrics collection
        collectDefaultMetrics: true,
        metricsPrefix: 'news_dedup_',
        
        // Health check endpoints
        healthChecks: {
          database: true,
          redis: true,
          feeds: true,
          memory: true,
          disk: true,
        },
        
        // Alerting thresholds
        thresholds: {
          memoryUsage: 0.85,
          diskUsage: 0.9,
          responseTime: 5000,
          errorRate: 0.05,
        },
      },
      
      // File paths
      paths: {
        root: path.resolve(__dirname, '../..'),
        src: path.resolve(__dirname, '..'),
        config: path.resolve(__dirname, '../../config'),
        logs: path.resolve(__dirname, '../../logs'),
        data: path.resolve(__dirname, '../../data'),
        temp: path.resolve(__dirname, '../../temp'),
      },
    };

    return config;
  }

  get(path) {
    return this.getNestedValue(this.config, path);
  }

  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
  }

  isDevelopment() {
    return this.config.env === 'development';
  }

  isProduction() {
    return this.config.env === 'production';
  }

  isTest() {
    return this.config.env === 'test';
  }

  validateApiKeys() {
    const requiredKeys = [];
    const missingKeys = [];

    // Check for at least one AI provider
    if (!this.config.ai.openai.apiKey && 
        !this.config.ai.anthropic.apiKey && 
        !this.config.ai.cohere.apiKey) {
      missingKeys.push('At least one AI provider API key (OpenAI, Anthropic, or Cohere)');
    }

    if (missingKeys.length > 0) {
      throw new Error(`Missing required API keys: ${missingKeys.join(', ')}`);
    }
  }

  getAvailableAiProviders() {
    const providers = [];
    
    if (this.config.ai.openai.apiKey) providers.push('openai');
    if (this.config.ai.anthropic.apiKey) providers.push('anthropic');
    if (this.config.ai.cohere.apiKey) providers.push('cohere');
    
    return providers;
  }
}

// Create singleton instance
const configManager = new ConfigManager();

// Validate API keys on startup
try {
  configManager.validateApiKeys();
} catch (error) {
  console.error('⚠️  Configuration warning:', error.message);
}

module.exports = configManager.config;