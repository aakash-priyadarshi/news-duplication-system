// src/services/DeduplicationEngine.js - Fixed TF-IDF implementation

const EventEmitter = require('events');
const natural = require('natural');
const stringSimilarity = require('string-similarity');
const Levenshtein = require('levenshtein');
const crypto = require('crypto');
const stopword = require('stopword');

const logger = require('../utils/logger');
const config = require('../config/config');
const LLMAnalyzer = require('../utils/LLMAnalyzer');
const VectorSimilarity = require('../utils/VectorSimilarity');
const ClusteringEngine = require('../utils/ClusteringEngine');

// Fixed TF-IDF implementation
class SimpleTfIdf {
  constructor() {
    this.documents = [];
    this.vocabulary = new Set();
    this.documentFrequencies = new Map();
  }

  addDocument(document) {
    if (!document || typeof document !== 'string') {
      return;
    }
    
    const words = this.tokenize(document);
    this.documents.push(words);
    
    // Update vocabulary and document frequencies
    const uniqueWords = new Set(words);
    uniqueWords.forEach(word => {
      this.vocabulary.add(word);
      this.documentFrequencies.set(word, (this.documentFrequencies.get(word) || 0) + 1);
    });
  }

  tokenize(text) {
    if (!text || typeof text !== 'string') return [];
    
    return text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && word.length < 20)
      .slice(0, 1000); // Limit words to prevent memory issues
  }

  tf(term, document) {
    if (!document || document.length === 0) return 0;
    const termCount = document.filter(word => word === term).length;
    return termCount / document.length;
  }

  idf(term) {
    const docsWithTerm = this.documentFrequencies.get(term) || 0;
    if (docsWithTerm === 0) return 0;
    return Math.log(this.documents.length / docsWithTerm);
  }

  tfidf(term, docIndex) {
    if (docIndex >= this.documents.length || docIndex < 0) return 0;
    const document = this.documents[docIndex];
    if (!document) return 0;
    
    return this.tf(term, document) * this.idf(term);
  }

  getVector(docIndex) {
    if (docIndex >= this.documents.length || docIndex < 0) return [];
    
    const vector = [];
    const vocab = Array.from(this.vocabulary).slice(0, 500); // Limit vocabulary size
    
    for (const term of vocab) {
      vector.push(this.tfidf(term, docIndex));
    }
    
    return vector;
  }

  // Calculate cosine similarity between two document vectors
  calculateSimilarity(docIndex1, docIndex2) {
    const vector1 = this.getVector(docIndex1);
    const vector2 = this.getVector(docIndex2);
    
    if (vector1.length === 0 || vector2.length === 0) return 0;
    
    return this.cosineSimilarity(vector1, vector2);
  }

  cosineSimilarity(vectorA, vectorB) {
    if (!vectorA || !vectorB || vectorA.length !== vectorB.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vectorA.length; i++) {
      dotProduct += vectorA[i] * vectorB[i];
      normA += vectorA[i] * vectorA[i];
      normB += vectorB[i] * vectorB[i];
    }
    
    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }
}

class DeduplicationEngine extends EventEmitter {
  constructor() {
    super();
    this.dbManager = null;
    this.llmAnalyzer = new LLMAnalyzer();
    this.vectorSimilarity = new VectorSimilarity();
    this.clusteringEngine = new ClusteringEngine();
    
    this.processingQueue = [];
    this.isProcessing = false;
    
    // Statistics
    this.stats = {
      articlesProcessed: 0,
      duplicatesDetected: 0,
      uniqueArticles: 0,
      averageProcessingTime: 0,
      lastProcessedAt: null,
      errors: 0
    };
    
    // Time window for clustering (in milliseconds)
    this.timeWindow = config.deduplication.timeWindowHours * 60 * 60 * 1000;
    
    // Similarity thresholds for different methods
    this.thresholds = {
      contentHash: 1.0,
      titleSimilarity: 0.9,
      contentSimilarity: config.deduplication.similarityThreshold,
      entitySimilarity: 0.8,
      semanticSimilarity: config.deduplication.similarityThreshold,
      llmValidation: 0.85
    };
  }

  async initialize(dbManager) {
    this.dbManager = dbManager;
    await this.llmAnalyzer.initialize();
    await this.vectorSimilarity.initialize();
    await this.clusteringEngine.initialize();
    
    logger.info('🔍 Deduplication engine initialized');
  }

  async startProcessing() {
    // Start processing queue worker
    setInterval(() => {
      if (!this.isProcessing && this.processingQueue.length > 0) {
        this.processQueue();
      }
    }, 1000);
    
    logger.info('🚀 Deduplication processing started');
  }

  async processArticle(article) {
    // Add to processing queue
    this.processingQueue.push({
      article,
      timestamp: Date.now(),
      retryCount: 0
    });
    
    logger.debug(`📥 Article queued for deduplication: ${article.title}`);
  }

  async processQueue() {
    if (this.processingQueue.length === 0) return;
    
    this.isProcessing = true;
    const startTime = Date.now();
    
    try {
      const batchSize = Math.min(config.performance.batchSize, this.processingQueue.length);
      const batch = this.processingQueue.splice(0, batchSize);
      
      logger.info(`🔄 Processing deduplication batch of ${batch.length} articles`);
      
      for (const item of batch) {
        try {
          await this.performDeduplication(item.article);
          this.stats.articlesProcessed++;
        } catch (error) {
          logger.error(`❌ Failed to process article ${item.article._id}:`, error);
          this.stats.errors++;
          
          // Retry logic
          if (item.retryCount < 3) {
            item.retryCount++;
            this.processingQueue.push(item);
          }
        }
      }
      
      const duration = Date.now() - startTime;
      this.stats.averageProcessingTime = 
        (this.stats.averageProcessingTime + duration) / 2;
      this.stats.lastProcessedAt = new Date();
      
      logger.info(`✅ Processed batch in ${duration}ms`);
      
    } catch (error) {
      logger.error('❌ Batch processing failed:', error);
      this.stats.errors++;
    } finally {
      this.isProcessing = false;
    }
  }

  async performDeduplication(article) {
    const startTime = Date.now();
    
    try {
      logger.debug(`🔍 Analyzing article for duplicates: ${article.title}`);
      
      // Step 1: Get candidate articles within time window
      const candidates = await this.getCandidateArticles(article);
      
      if (candidates.length === 0) {
        await this.markAsUnique(article);
        return;
      }
      
      logger.debug(`📋 Found ${candidates.length} candidate articles for comparison`);
      
      // Step 2: Multi-layered similarity analysis
      const similarities = await this.analyzeSimilarities(article, candidates);
      
      // Step 3: Identify duplicates using combined scoring
      const duplicates = this.identifyDuplicates(similarities);
      
      if (duplicates.length > 0) {
        await this.processDuplicates(article, duplicates);
        this.stats.duplicatesDetected++;
      } else {
        await this.markAsUnique(article);
        this.stats.uniqueArticles++;
      }
      
      // Step 4: Update clustering
      await this.updateClusters(article, duplicates);
      
      const duration = Date.now() - startTime;
      logger.debug(`✅ Deduplication completed in ${duration}ms`);
      
    } catch (error) {
      logger.error('❌ Deduplication analysis failed:', error);
      this.stats.errors++;
      throw error;
    }
  }

  async getCandidateArticles(article) {
    const timeThreshold = new Date(Date.now() - this.timeWindow);
    
    // Build query to find potential duplicates
    const query = {
      _id: { $ne: article._id },
      publishedAt: { $gte: timeThreshold },
      $or: [
        // Same source (different timing)
        { source: article.source },
        
        // Similar categories
        { category: article.category },
        
        // Overlapping tags
        { tags: { $in: article.tags || [] } }
      ]
    };
    
    const candidates = await this.dbManager.findArticles(query, {
      sort: { publishedAt: -1 },
      limit: 50 // Reduced limit to prevent performance issues
    });
    
    return candidates;
  }

  async analyzeSimilarities(article, candidates) {
    const similarities = [];
    
    for (const candidate of candidates) {
      try {
        const similarity = await this.calculateSimilarityScore(article, candidate);
        
        if (similarity.overallScore > 0.3) { // Only keep promising candidates
          similarities.push({
            candidate,
            ...similarity
          });
        }
        
      } catch (error) {
        logger.warn(`⚠️  Failed to calculate similarity with ${candidate._id}:`, error.message);
      }
    }
    
    // Sort by overall similarity score
    return similarities.sort((a, b) => b.overallScore - a.overallScore);
  }

  async calculateSimilarityScore(article1, article2) {
    const scores = {};
    
    try {
      // 1. Content Hash Comparison (fastest)
      scores.contentHash = article1.contentHash === article2.contentHash ? 1.0 : 0.0;
      
      // If content hashes match, it's definitely a duplicate
      if (scores.contentHash === 1.0) {
        return {
          ...scores,
          overallScore: 1.0,
          method: 'content_hash'
        };
      }
      
      // 2. Title Similarity
      scores.titleSimilarity = this.calculateTextSimilarity(
        article1.title, 
        article2.title
      );
      
      // 3. Content Similarity (TF-IDF based) - Fixed implementation
      scores.contentSimilarity = await this.calculateContentSimilarity(
        article1, 
        article2
      );
      
      // 4. Entity Similarity
      scores.entitySimilarity = this.calculateEntitySimilarity(
        article1.entities || [], 
        article2.entities || []
      );
      
      // 5. Semantic Similarity (Vector embeddings)
      scores.semanticSimilarity = await this.calculateSemanticSimilarity(
        article1, 
        article2
      );
      
      // 6. Temporal Proximity
      scores.temporalProximity = this.calculateTemporalProximity(
        article1.publishedAt, 
        article2.publishedAt
      );
      
      // 7. Source and Category Alignment
      scores.sourceAlignment = this.calculateSourceAlignment(article1, article2);
      
      // Calculate weighted overall score
      const weights = config.deduplication;
      scores.overallScore = (
        scores.titleSimilarity * weights.titleWeight +
        scores.contentSimilarity * weights.contentWeight +
        scores.entitySimilarity * weights.entityWeight +
        scores.semanticSimilarity * 0.3 +
        scores.temporalProximity * 0.1 +
        scores.sourceAlignment * 0.1
      );
      
      // Determine primary detection method
      scores.method = this.determinePrimaryMethod(scores);
      
      return scores;
      
    } catch (error) {
      logger.warn('⚠️  Similarity calculation error:', error.message);
      return {
        contentHash: 0,
        titleSimilarity: 0,
        contentSimilarity: 0,
        entitySimilarity: 0,
        semanticSimilarity: 0,
        temporalProximity: 0,
        sourceAlignment: 0,
        overallScore: 0,
        method: 'error'
      };
    }
  }

  calculateTextSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    
    try {
      // Normalize texts
      const norm1 = this.normalizeText(text1);
      const norm2 = this.normalizeText(text2);
      
      if (norm1.length === 0 || norm2.length === 0) return 0;
      
      // Calculate multiple similarity metrics
      const jaccardSim = this.jaccardSimilarity(norm1, norm2);
      const cosineSim = stringSimilarity.compareTwoStrings(norm1, norm2);
      
      // Return weighted average
      return (jaccardSim * 0.4 + cosineSim * 0.6);
    } catch (error) {
      logger.warn('Text similarity calculation failed:', error.message);
      return 0;
    }
  }

  async calculateContentSimilarity(article1, article2) {
    try {
      // Use TF-IDF for content similarity
      const content1 = this.preprocessContent(article1.content || article1.summary || '');
      const content2 = this.preprocessContent(article2.content || article2.summary || '');
      
      if (!content1 || !content2 || content1.length < 10 || content2.length < 10) {
        return 0;
      }
      
      // Create temporary TF-IDF instance for comparison
      const tfidf = new SimpleTfIdf();
      tfidf.addDocument(content1);
      tfidf.addDocument(content2);
      
      // Calculate similarity between the two documents
      return tfidf.calculateSimilarity(0, 1);
      
    } catch (error) {
      logger.warn('⚠️  Content similarity calculation failed:', error.message);
      return 0;
    }
  }

  calculateEntitySimilarity(entities1, entities2) {
    if (!entities1.length || !entities2.length) return 0;
    
    try {
      const names1 = new Set(entities1.map(e => e.name.toLowerCase()));
      const names2 = new Set(entities2.map(e => e.name.toLowerCase()));
      
      const intersection = new Set([...names1].filter(x => names2.has(x)));
      const union = new Set([...names1, ...names2]);
      
      return intersection.size / union.size; // Jaccard similarity
    } catch (error) {
      logger.warn('Entity similarity calculation failed:', error.message);
      return 0;
    }
  }

  async calculateSemanticSimilarity(article1, article2) {
    try {
      // Get or generate embeddings for both articles
      const embedding1 = await this.getOrGenerateEmbedding(article1);
      const embedding2 = await this.getOrGenerateEmbedding(article2);
      
      if (!embedding1 || !embedding2) return 0;
      
      return this.cosineSimilarity(embedding1, embedding2);
      
    } catch (error) {
      logger.warn('⚠️  Semantic similarity calculation failed:', error.message);
      return 0;
    }
  }

  calculateTemporalProximity(date1, date2) {
    try {
      const timeDiff = Math.abs(new Date(date1) - new Date(date2));
      const hoursDiff = timeDiff / (1000 * 60 * 60);
      
      // Closer in time = higher score
      return Math.max(0, 1 - (hoursDiff / 24)); // Normalize to 24 hours
    } catch (error) {
      return 0;
    }
  }

  calculateSourceAlignment(article1, article2) {
    try {
      let score = 0;
      
      // Same source
      if (article1.source === article2.source) score += 0.4;
      
      // Same category
      if (article1.category === article2.category) score += 0.3;
      
      // Overlapping tags
      const tags1 = new Set(article1.tags || []);
      const tags2 = new Set(article2.tags || []);
      const tagOverlap = [...tags1].filter(tag => tags2.has(tag)).length;
      const maxTags = Math.max(tags1.size, tags2.size);
      if (maxTags > 0) score += (tagOverlap / maxTags) * 0.3;
      
      return Math.min(score, 1.0);
    } catch (error) {
      return 0;
    }
  }

  identifyDuplicates(similarities) {
    const duplicates = [];
    
    for (const similarity of similarities) {
      const { candidate, overallScore, method } = similarity;
      
      // Apply threshold based on detection method
      let threshold;
      switch (method) {
        case 'content_hash':
          threshold = this.thresholds.contentHash;
          break;
        case 'title_similarity':
          threshold = this.thresholds.titleSimilarity;
          break;
        case 'semantic_similarity':
          threshold = this.thresholds.semanticSimilarity;
          break;
        default:
          threshold = this.thresholds.contentSimilarity;
      }
      
      if (overallScore >= threshold) {
        duplicates.push({
          article: candidate,
          similarity: similarity,
          confidence: overallScore
        });
      }
    }
    
    return duplicates;
  }

  async processDuplicates(article, duplicates) {
    logger.info(`🔍 Found ${duplicates.length} duplicates for article: ${article.title}`);
    
    // Find the original article (earliest publication)
    const allArticles = [article, ...duplicates.map(d => d.article)];
    const originalArticle = allArticles.reduce((earliest, current) => 
      new Date(current.publishedAt) < new Date(earliest.publishedAt) ? current : earliest
    );
    
    // Record duplicate relationships
    for (const duplicate of duplicates) {
      await this.dbManager.insertDuplicate({
        originalArticleId: originalArticle._id,
        duplicateArticleId: duplicate.article._id,
        similarityScore: duplicate.confidence,
        detectionMethod: duplicate.similarity.method,
        similarityBreakdown: duplicate.similarity,
        metadata: {
          originalTitle: originalArticle.title,
          duplicateTitle: duplicate.article.title,
          originalSource: originalArticle.source,
          duplicateSource: duplicate.article.source,
          timeDifference: Math.abs(
            new Date(originalArticle.publishedAt) - new Date(duplicate.article.publishedAt)
          )
        },
        createdAt: new Date()
      });
    }
    
    // Mark the current article appropriately
    if (article._id.toString() === originalArticle._id.toString()) {
      // This is the original article
      await this.markAsUnique(article);
      this.emit('uniqueArticleDetected', article);
    } else {
      // This is a duplicate
      await this.markAsDuplicate(article, originalArticle._id);
    }
  }

  async markAsUnique(article) {
    await this.dbManager.updateArticle(
      { _id: article._id },
      { 
        processed: true,
        duplicateChecked: true,
        isDuplicate: false,
        processedAt: new Date()
      }
    );
    
    logger.debug(`✅ Article marked as unique: ${article.title}`);
  }

  async markAsDuplicate(article, originalArticleId) {
    await this.dbManager.updateArticle(
      { _id: article._id },
      { 
        processed: true,
        duplicateChecked: true,
        isDuplicate: true,
        originalArticleId: originalArticleId,
        processedAt: new Date()
      }
    );
    
    logger.debug(`🔄 Article marked as duplicate: ${article.title}`);
  }

  async updateClusters(article, duplicates) {
    try {
      // Update clustering information for better future detection
      await this.clusteringEngine.updateClusters(article, duplicates);
    } catch (error) {
      logger.warn('⚠️  Failed to update clusters:', error.message);
    }
  }

  async getOrGenerateEmbedding(article) {
    try {
      // Check if embedding already exists
      let embedding = await this.dbManager.findEmbedding(article._id);
      
      if (!embedding) {
        // Generate new embedding
        const text = `${article.title} ${article.content || article.summary}`;
        const vector = await this.vectorSimilarity.generateEmbedding(text);
        
        if (vector) {
          // Store embedding
          await this.dbManager.insertEmbedding({
            articleId: article._id,
            vector: vector,
            model: config.deduplication.semanticModel,
            textLength: text.length,
            createdAt: new Date()
          });
          
          return vector;
        }
      } else {
        return embedding.vector;
      }
      
      return null;
      
    } catch (error) {
      logger.warn('⚠️  Failed to get/generate embedding:', error.message);
      return null;
    }
  }

  // Helper methods
  normalizeText(text) {
    if (!text) return '';
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  preprocessContent(content) {
    if (!content) return '';
    
    try {
      // Remove stop words and basic processing
      const words = this.normalizeText(content).split(' ')
        .filter(word => word.length > 2 && word.length < 15)
        .slice(0, 500); // Limit to prevent performance issues
      
      return stopword.removeStopwords(words).join(' ');
    } catch (error) {
      return content;
    }
  }

  jaccardSimilarity(text1, text2) {
    try {
      const set1 = new Set(text1.split(' '));
      const set2 = new Set(text2.split(' '));
      
      const intersection = new Set([...set1].filter(x => set2.has(x)));
      const union = new Set([...set1, ...set2]);
      
      return intersection.size / union.size;
    } catch (error) {
      return 0;
    }
  }

  cosineSimilarity(vectorA, vectorB) {
    if (!vectorA || !vectorB || vectorA.length !== vectorB.length) return 0;
    
    try {
      let dotProduct = 0;
      let normA = 0;
      let normB = 0;
      
      for (let i = 0; i < vectorA.length; i++) {
        dotProduct += vectorA[i] * vectorB[i];
        normA += vectorA[i] * vectorA[i];
        normB += vectorB[i] * vectorB[i];
      }
      
      const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
      return magnitude === 0 ? 0 : dotProduct / magnitude;
    } catch (error) {
      return 0;
    }
  }

  determinePrimaryMethod(scores) {
    if (scores.contentHash === 1.0) return 'content_hash';
    if (scores.titleSimilarity > 0.9) return 'title_similarity';
    if (scores.semanticSimilarity > 0.85) return 'semantic_similarity';
    if (scores.entitySimilarity > 0.8) return 'entity_similarity';
    return 'content_similarity';
  }

  async stop() {
    this.isProcessing = false;
    this.processingQueue = [];
    logger.info('🔍 Deduplication engine stopped');
  }

  getStats() {
    return {
      ...this.stats,
      queueSize: this.processingQueue.length,
      isProcessing: this.isProcessing,
      thresholds: this.thresholds,
      timeWindow: this.timeWindow
    };
  }
}

module.exports = DeduplicationEngine;