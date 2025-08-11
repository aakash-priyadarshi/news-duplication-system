const { MongoClient } = require('mongodb');
const Redis = require('redis');
const EventEmitter = require('events');
const logger = require('../utils/logger');
const config = require('../config/config');

class DatabaseManager extends EventEmitter {
  constructor() {
    super();
    this.mongoClient = null;
    this.mongodb = null;
    this.redisClient = null;
    this.isConnected = false;
    this.connectionRetries = 0;
    this.maxRetries = 5;
    this.retryDelay = 5000;
  }

  async connect() {
    try {
      logger.info('🔌 Connecting to databases...');
      
      // Connect to MongoDB
      await this.connectMongoDB();
      
      // Connect to Redis
      await this.connectRedis();
      
      // Initialize collections and indexes
      await this.initializeCollections();
      
      this.isConnected = true;
      this.emit('connected');
      
      logger.info('✅ Database connections established successfully');
      
    } catch (error) {
      logger.error('❌ Database connection failed:', error);
      
      if (this.connectionRetries < this.maxRetries) {
        this.connectionRetries++;
        logger.info(`🔄 Retrying connection in ${this.retryDelay}ms (attempt ${this.connectionRetries}/${this.maxRetries})`);
        
        setTimeout(() => {
          this.connect();
        }, this.retryDelay);
      } else {
        logger.error('💥 Max connection retries exceeded');
        throw error;
      }
    }
  }

  async connectMongoDB() {
    try {
      this.mongoClient = new MongoClient(config.database.mongodb.uri, config.database.mongodb.options);
      await this.mongoClient.connect();
      
      // Test the connection
      await this.mongoClient.db().admin().ping();
      
      this.mongodb = this.mongoClient.db();
      logger.info('✅ MongoDB connected');
      
      // Set up MongoDB event listeners
      this.mongoClient.on('error', (error) => {
        logger.error('🚨 MongoDB error:', error);
        this.emit('mongoError', error);
      });
      
      this.mongoClient.on('close', () => {
        logger.warn('⚠️  MongoDB connection closed');
        this.emit('mongoDisconnected');
      });
      
    } catch (error) {
      logger.error('❌ MongoDB connection failed:', error);
      throw error;
    }
  }

  async connectRedis() {
    try {
      this.redisClient = Redis.createClient(config.database.redis);
      
      // Set up Redis event listeners
      this.redisClient.on('error', (error) => {
        logger.error('🚨 Redis error:', error);
        this.emit('redisError', error);
      });
      
      this.redisClient.on('connect', () => {
        logger.info('✅ Redis connected');
      });
      
      this.redisClient.on('ready', () => {
        logger.info('🚀 Redis ready');
      });
      
      this.redisClient.on('end', () => {
        logger.warn('⚠️  Redis connection ended');
        this.emit('redisDisconnected');
      });
      
      await this.redisClient.connect();
      
      // Test the connection
      await this.redisClient.ping();
      
    } catch (error) {
      logger.error('❌ Redis connection failed:', error);
      throw error;
    }
  }

  async initializeCollections() {
    try {
      logger.info('🏗️  Initializing database collections and indexes...');
      
      // Articles collection
      const articlesCollection = this.mongodb.collection('articles');
      await this.createIndexes(articlesCollection, [
        { key: { url: 1 }, options: { unique: true } },
        { key: { contentHash: 1 } },
        { key: { publishedAt: -1 } },
        { key: { source: 1, publishedAt: -1 } },
        { key: { processed: 1, createdAt: -1 } },
        { key: { 'entities.name': 1 } },
        { key: { category: 1, publishedAt: -1 } },
        { key: { tags: 1 } },
        
        // Text search index
        { 
          key: { 
            title: 'text', 
            content: 'text', 
            summary: 'text',
            'entities.name': 'text'
          },
          options: { 
            name: 'article_text_search',
            weights: {
              title: 10,
              content: 5,
              summary: 8,
              'entities.name': 3
            }
          }
        },
        
        // Geospatial index for location-based articles
        { key: { location: '2dsphere' } },
        
        // TTL index for old articles cleanup
        { 
          key: { createdAt: 1 }, 
          options: { 
            expireAfterSeconds: 60 * 60 * 24 * 90 // 90 days
          }
        }
      ]);
      
      // Duplicates collection
      const duplicatesCollection = this.mongodb.collection('duplicates');
      await this.createIndexes(duplicatesCollection, [
        { key: { originalArticleId: 1 } },
        { key: { duplicateArticleId: 1 } },
        { key: { similarityScore: -1 } },
        { key: { detectionMethod: 1 } },
        { key: { createdAt: -1 } },
        { key: { originalArticleId: 1, duplicateArticleId: 1 }, options: { unique: true } }
      ]);
      
      // Alerts collection
      const alertsCollection = this.mongodb.collection('alerts');
      await this.createIndexes(alertsCollection, [
        { key: { articleId: 1 } },
        { key: { status: 1, createdAt: -1 } },
        { key: { channels: 1 } },
        { key: { priority: 1, createdAt: -1 } },
        { key: { sentAt: -1 } },
        
        // TTL index for alert cleanup
        { 
          key: { createdAt: 1 }, 
          options: { 
            expireAfterSeconds: 60 * 60 * 24 * 30 // 30 days
          }
        }
      ]);
      
      // RSS Feeds collection
      const feedsCollection = this.mongodb.collection('feeds');
      await this.createIndexes(feedsCollection, [
        { key: { url: 1 }, options: { unique: true } },
        { key: { enabled: 1 } },
        { key: { lastFetchedAt: -1 } },
        { key: { category: 1 } },
        { key: { priority: 1 } }
      ]);
      
      // Processing Queue collection
      const queueCollection = this.mongodb.collection('processing_queue');
      await this.createIndexes(queueCollection, [
        { key: { status: 1, priority: -1, createdAt: 1 } },
        { key: { type: 1, status: 1 } },
        { key: { attempts: 1 } },
        { key: { scheduledFor: 1 } },
        
        // TTL index for completed jobs cleanup
        { 
          key: { completedAt: 1 }, 
          options: { 
            expireAfterSeconds: 60 * 60 * 24 * 7, // 7 days
            partialFilterExpression: { status: 'completed' }
          }
        }
      ]);
      
      // Metrics collection
      const metricsCollection = this.mongodb.collection('metrics');
      await this.createIndexes(metricsCollection, [
        { key: { timestamp: -1 } },
        { key: { type: 1, timestamp: -1 } },
        { key: { source: 1, timestamp: -1 } },
        
        // TTL index for metrics cleanup
        { 
          key: { timestamp: 1 }, 
          options: { 
            expireAfterSeconds: 60 * 60 * 24 * 30 // 30 days
          }
        }
      ]);
      
      // Vector embeddings collection (for semantic similarity)
      const embeddingsCollection = this.mongodb.collection('embeddings');
      await this.createIndexes(embeddingsCollection, [
        { key: { articleId: 1 }, options: { unique: true } },
        { key: { model: 1 } },
        { key: { createdAt: -1 } },
        
        // TTL index
        { 
          key: { createdAt: 1 }, 
          options: { 
            expireAfterSeconds: config.performance.cacheSettings.vectorTtl
          }
        }
      ]);
      
      logger.info('✅ Database collections and indexes initialized');
      
    } catch (error) {
      logger.error('❌ Failed to initialize collections:', error);
      throw error;
    }
  }

  async createIndexes(collection, indexes) {
    for (const index of indexes) {
      try {
        await collection.createIndex(index.key, index.options || {});
      } catch (error) {
        // Ignore duplicate index errors
        if (!error.message.includes('already exists')) {
          logger.warn(`⚠️  Failed to create index:`, error.message);
        }
      }
    }
  }

  // MongoDB Operations
  async insertArticle(article) {
    return this.mongodb.collection('articles').insertOne({
      ...article,
      createdAt: new Date(),
      updatedAt: new Date()
    });
  }

  async findArticle(query) {
    return this.mongodb.collection('articles').findOne(query);
  }

  async findArticles(query, options = {}) {
    return this.mongodb.collection('articles').find(query, options).toArray();
  }

  async updateArticle(query, update) {
    return this.mongodb.collection('articles').updateOne(query, {
      $set: { ...update, updatedAt: new Date() }
    });
  }

  async insertDuplicate(duplicate) {
    return this.mongodb.collection('duplicates').insertOne({
      ...duplicate,
      createdAt: new Date()
    });
  }

  async findDuplicates(query, options = {}) {
    return this.mongodb.collection('duplicates').find(query, options).toArray();
  }

  async insertAlert(alert) {
    return this.mongodb.collection('alerts').insertOne({
      ...alert,
      createdAt: new Date()
    });
  }

  async updateAlert(query, update) {
    return this.mongodb.collection('alerts').updateOne(query, {
      $set: { ...update, updatedAt: new Date() }
    });
  }

  async insertMetric(metric) {
    return this.mongodb.collection('metrics').insertOne({
      ...metric,
      timestamp: new Date()
    });
  }

  async findMetrics(query, options = {}) {
    return this.mongodb.collection('metrics').find(query, options).toArray();
  }

  async insertEmbedding(embedding) {
    return this.mongodb.collection('embeddings').replaceOne(
      { articleId: embedding.articleId },
      { ...embedding, createdAt: new Date() },
      { upsert: true }
    );
  }

  async findEmbedding(articleId) {
    return this.mongodb.collection('embeddings').findOne({ articleId });
  }

  // Redis Operations
  async setCache(key, value, ttl = 3600) {
    const serializedValue = typeof value === 'string' ? value : JSON.stringify(value);
    return this.redisClient.setEx(key, ttl, serializedValue);
  }

  async getCache(key) {
    const value = await this.redisClient.get(key);
    if (!value) return null;
    
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  async deleteCache(key) {
    return this.redisClient.del(key);
  }

  async existsCache(key) {
    return this.redisClient.exists(key);
  }

  async incrementCounter(key, ttl = 3600) {
    const count = await this.redisClient.incr(key);
    if (count === 1) {
      await this.redisClient.expire(key, ttl);
    }
    return count;
  }

  // Utility methods
  async getHealthStatus() {
    const status = {
      mongodb: false,
      redis: false,
      overall: false
    };

    try {
      // Check MongoDB
      await this.mongodb.admin().ping();
      status.mongodb = true;
    } catch (error) {
      logger.error('MongoDB health check failed:', error.message);
    }

    try {
      // Check Redis
      await this.redisClient.ping();
      status.redis = true;
    } catch (error) {
      logger.error('Redis health check failed:', error.message);
    }

    status.overall = status.mongodb && status.redis;
    return status;
  }

  async getStats() {
    try {
      const stats = {};
      
      // MongoDB stats
      const dbStats = await this.mongodb.stats();
      stats.mongodb = {
        collections: dbStats.collections,
        dataSize: dbStats.dataSize,
        indexSize: dbStats.indexSize,
        storageSize: dbStats.storageSize
      };
      
      // Collection counts
      stats.collections = {
        articles: await this.mongodb.collection('articles').countDocuments(),
        duplicates: await this.mongodb.collection('duplicates').countDocuments(),
        alerts: await this.mongodb.collection('alerts').countDocuments(),
        feeds: await this.mongodb.collection('feeds').countDocuments()
      };
      
      // Redis stats
      const redisInfo = await this.redisClient.info();
      const redisStats = this.parseRedisInfo(redisInfo);
      stats.redis = {
        memory: redisStats.used_memory_human,
        keys: redisStats.db0 ? redisStats.db0.keys : 0,
        operations: redisStats.total_commands_processed
      };
      
      return stats;
      
    } catch (error) {
      logger.error('Failed to get database stats:', error);
      return { error: error.message };
    }
  }

  parseRedisInfo(info) {
    const lines = info.split('\r\n');
    const stats = {};
    
    for (const line of lines) {
      const [key, value] = line.split(':');
      if (key && value) {
        stats[key] = isNaN(value) ? value : Number(value);
      }
    }
    
    return stats;
  }

  async disconnect() {
    try {
      logger.info('🔌 Disconnecting from databases...');
      
      if (this.mongoClient) {
        await this.mongoClient.close();
        logger.info('✅ MongoDB disconnected');
      }
      
      if (this.redisClient) {
        await this.redisClient.quit();
        logger.info('✅ Redis disconnected');
      }
      
      this.isConnected = false;
      this.emit('disconnected');
      
    } catch (error) {
      logger.error('❌ Error disconnecting from databases:', error);
      throw error;
    }
  }
}

module.exports = DatabaseManager;