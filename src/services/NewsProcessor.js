const RSSParser = require('rss-parser');
const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');
const EventEmitter = require('events');
const cron = require('node-cron');
const fs = require('fs').promises;

const logger = require('../utils/logger');
const config = require('../config/config');
const ContentExtractor = require('../utils/ContentExtractor');
const EntityExtractor = require('../utils/EntityExtractor');

class NewsProcessor extends EventEmitter {
  constructor() {
    super();
    this.dbManager = null;
    this.rssParser = new RSSParser({
      timeout: config.feeds.timeoutMs,
      headers: {
        'User-Agent': config.feeds.userAgent,
      },
      customFields: {
        item: [
          ['media:content', 'mediaContent'],
          ['media:thumbnail', 'mediaThumbnail'],
          ['dc:creator', 'creator'],
          ['content:encoded', 'contentEncoded'],
          ['excerpt:encoded', 'excerptEncoded'],
          ['wfw:commentRss', 'commentRss'],
          ['slash:comments', 'commentCount']
        ],
        feed: [
          ['language', 'language'],
          ['sy:updatePeriod', 'updatePeriod'],
          ['sy:updateFrequency', 'updateFrequency']
        ]
      }
    });
    
    this.contentExtractor = new ContentExtractor();
    this.entityExtractor = new EntityExtractor();
    this.feeds = [];
    this.cronJob = null;
    this.isProcessing = false;
    this.processingStats = {
      totalProcessed: 0,
      totalDuplicates: 0,
      totalErrors: 0,
      lastProcessedAt: null
    };
  }

  async initialize(dbManager) {
    this.dbManager = dbManager;
    await this.loadFeeds();
    logger.info('📰 News processor initialized');
  }

  async loadFeeds() {
    try {
      const feedsConfig = await fs.readFile(config.feeds.configFile, 'utf8');
      const { feeds } = JSON.parse(feedsConfig);
      
      this.feeds = feeds.filter(feed => feed.enabled);
      
      // Store feeds in database for tracking
      for (const feed of this.feeds) {
        await this.dbManager.mongodb.collection('feeds').replaceOne(
          { id: feed.id },
          {
            ...feed,
            lastFetchedAt: null,
            articlesProcessed: 0,
            errorCount: 0,
            createdAt: new Date(),
            updatedAt: new Date()
          },
          { upsert: true }
        );
      }
      
      logger.info(`📡 Loaded ${this.feeds.length} active RSS feeds`);
      
    } catch (error) {
      logger.error('❌ Failed to load RSS feeds configuration:', error);
      throw error;
    }
  }

  async startFeedMonitoring() {
    if (this.cronJob) {
      this.cronJob.stop();
    }

    // Calculate cron pattern based on refresh interval
    const intervalMinutes = Math.floor(config.feeds.refreshIntervalMs / 60000);
    const cronPattern = `*/${intervalMinutes} * * * *`;
    
    this.cronJob = cron.schedule(cronPattern, async () => {
      if (!this.isProcessing) {
        await this.processAllFeeds();
      } else {
        logger.warn('⚠️  Previous feed processing still in progress, skipping this cycle');
      }
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    logger.info(`⏰ Feed monitoring started with ${intervalMinutes} minute intervals`);
    
    // Process feeds immediately on startup
    await this.processAllFeeds();
  }

  async processAllFeeds() {
    this.isProcessing = true;
    const startTime = Date.now();
    
    logger.info('🔄 Starting RSS feed processing cycle...');
    
    try {
      // Process feeds in batches to avoid overwhelming the system
      const batchSize = config.performance.maxConcurrentFeeds;
      const feedBatches = this.chunkArray(this.feeds, batchSize);
      
      for (const batch of feedBatches) {
        const promises = batch.map(feed => this.processFeed(feed));
        await Promise.allSettled(promises);
      }
      
      const duration = Date.now() - startTime;
      this.processingStats.lastProcessedAt = new Date();
      
      logger.info(`✅ Feed processing cycle completed in ${duration}ms`);
      
      // Record metrics
      await this.recordMetrics({
        type: 'feed_processing_cycle',
        duration,
        feedsProcessed: this.feeds.length,
        articlesProcessed: this.processingStats.totalProcessed,
        duplicatesFound: this.processingStats.totalDuplicates,
        errorsEncountered: this.processingStats.totalErrors
      });
      
    } catch (error) {
      logger.error('❌ Feed processing cycle failed:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  async processFeed(feed) {
    const startTime = Date.now();
    let articlesProcessed = 0;
    
    try {
      logger.info(`📡 Processing feed: ${feed.name} (${feed.url})`);
      
      // Parse RSS feed
      const feedData = await this.rssParser.parseURL(feed.url);
      
      // Update feed metadata
      await this.updateFeedMetadata(feed, feedData);
      
      // Process each article
      for (const item of feedData.items) {
        try {
          const article = await this.processArticle(item, feed);
          if (article) {
            articlesProcessed++;
            this.emit('articleProcessed', article);
          }
        } catch (error) {
          logger.error(`❌ Failed to process article from ${feed.name}:`, error.message);
          this.processingStats.totalErrors++;
        }
      }
      
      // Update feed statistics
      await this.dbManager.mongodb.collection('feeds').updateOne(
        { id: feed.id },
        {
          $set: {
            lastFetchedAt: new Date(),
            updatedAt: new Date()
          },
          $inc: {
            articlesProcessed: articlesProcessed
          }
        }
      );
      
      const duration = Date.now() - startTime;
      logger.info(`✅ Processed ${articlesProcessed} articles from ${feed.name} in ${duration}ms`);
      
    } catch (error) {
      logger.error(`❌ Failed to process feed ${feed.name}:`, error.message);
      
      // Update error count
      await this.dbManager.mongodb.collection('feeds').updateOne(
        { id: feed.id },
        {
          $inc: { errorCount: 1 },
          $set: { 
            lastError: error.message,
            lastErrorAt: new Date(),
            updatedAt: new Date()
          }
        }
      );
      
      this.processingStats.totalErrors++;
    }
  }

  async processArticle(item, feed) {
    try {
      // Extract basic article data
      const article = await this.extractArticleData(item, feed);
      
      // Check if article already exists
      const existingArticle = await this.dbManager.findArticle({ url: article.url });
      if (existingArticle) {
        logger.debug(`⚠️  Article already exists: ${article.title}`);
        this.processingStats.totalDuplicates++;
        return null;
      }
      
      // Generate content hash for deduplication
      article.contentHash = this.generateContentHash(article);
      
      // Check for content hash duplicates
      const duplicateByHash = await this.dbManager.findArticle({ 
        contentHash: article.contentHash 
      });
      
      if (duplicateByHash) {
        logger.debug(`⚠️  Duplicate content detected: ${article.title}`);
        
        // Record the duplicate relationship
        await this.dbManager.insertDuplicate({
          originalArticleId: duplicateByHash._id,
          duplicateArticleId: null,
          duplicateUrl: article.url,
          similarityScore: 1.0,
          detectionMethod: 'content_hash',
          metadata: {
            originalSource: duplicateByHash.source,
            duplicateSource: article.source
          }
        });
        
        this.processingStats.totalDuplicates++;
        return null;
      }
      
      // Extract full content if enabled
      if (config.feeds.extractFullContent) {
        article.fullContent = await this.extractFullContent(article.url);
      }
      
      // Extract entities
      article.entities = await this.entityExtractor.extract(
        `${article.title} ${article.content || article.summary}`
      );
      
      // Generate summary if not present
      if (!article.summary && article.content) {
        article.summary = this.generateSummary(article.content);
      }
      
      // Add metadata
      article.processed = false;
      article.alertSent = false;
      article.duplicateChecked = false;
      
      // Insert article into database
      const result = await this.dbManager.insertArticle(article);
      article._id = result.insertedId;
      
      this.processingStats.totalProcessed++;
      logger.debug(`✅ Article processed: ${article.title}`);
      
      return article;
      
    } catch (error) {
      logger.error('❌ Failed to process article:', error);
      throw error;
    }
  }

  async extractArticleData(item, feed) {
    const article = {
      title: this.cleanText(item.title),
      url: item.link || item.guid,
      source: feed.name,
      sourceId: feed.id,
      category: feed.category,
      tags: feed.tags || [],
      priority: feed.priority || 'medium',
      
      // Content
      content: this.extractContent(item),
      summary: this.cleanText(item.summary || item.contentSnippet),
      
      // Metadata
      author: item.creator || item.author,
      publishedAt: this.parseDate(item.pubDate || item.isoDate),
      guid: item.guid,
      
      // Media
      imageUrl: this.extractImageUrl(item),
      
      // RSS specific - FIXED: Safely handle categories
      categories: this.extractCategories(item.categories),
      
      // Processing metadata
      fetchedAt: new Date(),
      language: this.detectLanguage(item.title + ' ' + (item.summary || '')),
    };
    
    // Add location if extractable
    const location = this.extractLocation(item);
    if (location) {
      article.location = location;
    }
    
    return article;
  }

  // FIXED: New method to safely extract categories
  extractCategories(categories) {
    if (!categories) return [];
    
    if (!Array.isArray(categories)) return [];
    
    return categories.map(cat => {
      // Handle both string categories and object categories
      if (typeof cat === 'string') {
        return cat;
      } else if (typeof cat === 'object' && cat !== null) {
        // Handle different object structures
        return cat._ || cat.name || cat.term || String(cat);
      }
      return String(cat);
    }).filter(cat => cat && typeof cat === 'string');
  }

  extractContent(item) {
    // Try different content fields in order of preference
    const contentFields = [
      'contentEncoded',
      'content',
      'summary',
      'contentSnippet',
      'excerptEncoded'
    ];
    
    for (const field of contentFields) {
      if (item[field]) {
        return this.cleanText(item[field]);
      }
    }
    
    return null;
  }

  extractImageUrl(item) {
    // Try different image sources
    if (item.enclosure && item.enclosure.type && item.enclosure.type.startsWith('image/')) {
      return item.enclosure.url;
    }
    
    if (item.mediaContent && item.mediaContent.$ && item.mediaContent.$.url) {
      return item.mediaContent.$.url;
    }
    
    if (item.mediaThumbnail && item.mediaThumbnail.$ && item.mediaThumbnail.$.url) {
      return item.mediaThumbnail.$.url;
    }
    
    // Extract from content
    if (item.content || item.contentEncoded) {
      const content = item.content || item.contentEncoded;
      const $ = cheerio.load(content);
      const firstImg = $('img').first();
      if (firstImg.length) {
        return firstImg.attr('src');
      }
    }
    
    return null;
  }

  extractLocation(item) {
    // Look for location in various fields
    const locationPatterns = [
      /(?:in|from|at)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),?\s*([A-Z]{2}|[A-Z][a-z]+)/g,
      /([A-Z][a-z]+),\s*([A-Z]{2})/g
    ];
    
    // FIXED: Safely handle categories and other fields
    const categoriesText = this.extractCategories(item.categories).join(' ');
    const textToSearch = `${item.title || ''} ${item.summary || ''} ${categoriesText}`;
    
    for (const pattern of locationPatterns) {
      const match = pattern.exec(textToSearch);
      if (match) {
        return {
          city: match[1],
          state: match[2],
          country: this.inferCountry(match[2])
        };
      }
    }
    
    return null;
  }

  async extractFullContent(url) {
    try {
      const response = await axios.get(url, {
        timeout: config.feeds.timeoutMs,
        headers: {
          'User-Agent': config.feeds.userAgent,
        },
        maxRedirects: config.feeds.maxRedirects,
      });
      
      return await this.contentExtractor.extract(response.data, url);
      
    } catch (error) {
      logger.warn(`⚠️  Failed to extract full content from ${url}:`, error.message);
      return null;
    }
  }

  generateContentHash(article) {
    // Create a normalized version of the content for hashing
    const normalizedContent = this.normalizeForHashing(
      `${article.title} ${article.content || article.summary}`
    );
    
    return crypto
      .createHash(config.deduplication.contentFingerprintAlgo)
      .update(normalizedContent)
      .digest('hex');
  }

  normalizeForHashing(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .replace(/\s+/g, ' ')    // Normalize whitespace
      .trim();
  }

  generateSummary(content, maxLength = 300) {
    if (!content || content.length <= maxLength) {
      return content;
    }
    
    // Find the last complete sentence within the limit
    const truncated = content.substring(0, maxLength);
    const lastSentence = truncated.lastIndexOf('.');
    
    if (lastSentence > maxLength * 0.7) {
      return truncated.substring(0, lastSentence + 1);
    }
    
    return truncated + '...';
  }

  cleanText(text) {
    if (!text) return null;
    
    return text
      .replace(/\s+/g, ' ')           // Normalize whitespace
      .replace(/^\s+|\s+$/g, '')      // Trim
      .replace(/&nbsp;/g, ' ')        // Replace HTML entities
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  parseDate(dateString) {
    if (!dateString) return new Date();
    
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? new Date() : date;
  }

  detectLanguage(text) {
    // Simple language detection (could be enhanced with a proper library)
    if (!text) return 'en';
    
    // Basic patterns for common languages
    const patterns = {
      en: /\b(the|and|or|but|in|on|at|to|for|of|with|by)\b/gi,
      es: /\b(el|la|los|las|y|o|pero|en|con|por|para|de)\b/gi,
      fr: /\b(le|la|les|et|ou|mais|dans|sur|pour|de|avec)\b/gi,
      de: /\b(der|die|das|und|oder|aber|in|auf|für|von|mit)\b/gi,
    };
    
    let maxMatches = 0;
    let detectedLang = 'en';
    
    for (const [lang, pattern] of Object.entries(patterns)) {
      const matches = (text.match(pattern) || []).length;
      if (matches > maxMatches) {
        maxMatches = matches;
        detectedLang = lang;
      }
    }
    
    return detectedLang;
  }

  inferCountry(stateOrCountry) {
    // US state codes
    const usStates = [
      'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
      'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
      'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
      'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
      'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
    ];
    
    if (usStates.includes(stateOrCountry)) {
      return 'US';
    }
    
    return stateOrCountry.length === 2 ? null : stateOrCountry;
  }

  async updateFeedMetadata(feed, feedData) {
    const metadata = {
      title: feedData.title,
      description: feedData.description,
      language: feedData.language,
      lastBuildDate: this.parseDate(feedData.lastBuildDate),
      generator: feedData.generator,
      webMaster: feedData.webMaster,
      managingEditor: feedData.managingEditor,
      copyright: feedData.copyright,
      itemCount: feedData.items.length,
      updatedAt: new Date()
    };
    
    await this.dbManager.mongodb.collection('feeds').updateOne(
      { id: feed.id },
      { $set: { metadata } }
    );
  }

  async recordMetrics(metrics) {
    await this.dbManager.insertMetric({
      ...metrics,
      source: 'news_processor'
    });
  }

  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  async stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    
    this.isProcessing = false;
    logger.info('📰 News processor stopped');
  }

  getStats() {
    return {
      ...this.processingStats,
      isProcessing: this.isProcessing,
      feedCount: this.feeds.length,
      nextProcessingTime: this.cronJob ? this.cronJob.nextDates().toISOString() : null
    };
  }
}

module.exports = NewsProcessor;