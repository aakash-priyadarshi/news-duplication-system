const EventEmitter = require('events');
const natural = require('natural');
const stringSimilarity = require('string-similarity');
const Levenshtein = require('levenshtein');
const crypto = require('crypto');
const stopword = require('stopword');
const stemmer = require('stemmer');

const logger = require('../utils/logger');
const config = require('../config/config');
const LLMAnalyzer = require('../utils/LLMAnalyzer');
const VectorSimilarity = require('../utils/VectorSimilarity');
const ClusteringEngine = require('../utils/ClusteringEngine');

// Simple TF-IDF implementation since the library might not be available
class SimpleTfIdf {
  constructor() {
    this.documents = [];
    this.vocabulary = new Set();
  }

  addDocument(document) {
    const words = this.tokenize(document);
    this.documents.push(words);
    words.forEach(word => this.vocabulary.add(word));
  }

  tokenize(text) {
    return text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2);
  }

  tf(term, document) {
    const termCount = document.filter(word => word === term).length;
    return termCount / document.length;
  }

  idf(term) {
    const docsWithTerm = this.documents.filter(doc => doc.includes(term)).length;
    return Math.log(this.documents.length / (docsWithTerm || 1));
  }

  tfidf(term, docIndex) {
    if (docIndex >= this.documents.length) return 0;
    const document = this.documents[docIndex];
    return this.tf(term, document) * this.idf(term);
  }

  getVector(docIndex) {
    const vector = [];
    const vocab = Array.from(this.vocabulary);
    
    for (const term of vocab) {
      vector.push(this.tfidf(term, docIndex));
    }
    
    return vector;
  }
}

class DeduplicationEngine extends EventEmitter {
  constructor() {
    super();
    this.dbManager = null;
    this.llmAnalyzer = new LLMAnalyzer();
    this.vectorSimilarity = new VectorSimilarity();
    this.clusteringEngine = new ClusteringEngine();
    
    this.tfidf = new SimpleTfIdf();
    this.processingQueue = [];
    this.isProcessing = false;
    
    // Statistics
    this.stats = {
      articlesProcessed: 0,
      duplicatesDetected: 0,
      uniqueArticles: 0,
      averageProcessingTime: 0,
      lastProcessedAt: null
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
        { tags: { $in: article.tags } },
        
        // Similar entities
        { 'entities.name': { $in: article.entities?.map(e => e.name) || [] } }
      ]
    };
    
    const candidates = await this.dbManager.findArticles(query, {
      sort: { publishedAt: -1 },
      limit: 100 // Limit to avoid processing too many candidates
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
    
    // 3. Content Similarity (TF-IDF based)
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
  }

  calculateTextSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    
    // Normalize texts
    const norm1 = this.normalizeText(text1);
    const norm2 = this.normalizeText(text2);
    
    // Calculate multiple similarity metrics
    const jaccardSim = this.jaccardSimilarity(norm1, norm2);
    const cosineSim = stringSimilarity.compareTwoStrings(norm1, norm2);
    const levenshteinSim = 1 - (new Levenshtein(norm1, norm2).distance / Math.max(norm1.length, norm2.length));
    
    // Return weighted average
    return (jaccardSim * 0.3 + cosineSim * 0.5 + levenshteinSim * 0.2);
  }

  async calculateContentSimilarity(article1, article2) {
    try {
      // Use TF-IDF for content similarity
      const content1 = this.preprocessContent(article1.content || article1.summary);
      const content2 = this.preprocessContent(article2.content || article2.summary);
      
      if (!content1 || !content2) return 0;
      
      // Create temporary TF-IDF instance for comparison
      const tfidf = new SimpleTfIdf();
      tfidf.addDocument(content1);
      tfidf.addDocument(content2);
      
      // Calculate cosine similarity between TF-IDF vectors
      const vector1 = tfidf.getVector(0);
      const vector2 = tfidf.getVector(1);
      
      return this.cosineSimilarity(vector1, vector2);
      
    } catch (error) {
      logger.warn('⚠️  Content similarity calculation failed:', error.message);
      return 0;
    }
  }

  calculateEntitySimilarity(entities1, entities2) {
    if (!entities1.length || !entities2.length) return 0;
    
    const names1 = new Set(entities1.map(e => e.name.toLowerCase()));
    const names2 = new Set(entities2.map(e => e.name.toLowerCase()));
    
    const intersection = new Set([...names1].filter(x => names2.has(x)));
    const union = new Set([...names1, ...names2]);
    
    return intersection.size / union.size; // Jaccard similarity
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
    const timeDiff = Math.abs(new Date(date1) - new Date(date2));
    const hoursDiff = timeDiff / (1000 * 60 * 60);
    
    // Closer in time = higher score
    return Math.max(0, 1 - (hoursDiff / 24)); // Normalize to 24 hours
  }

  calculateSourceAlignment(article1, article2) {
    let score = 0;
    
    // Same source
    if (article1.source === article2.source) score += 0.4;
    
    // Same category
    if (article1.category === article2.category) score += 0.3;
    
    // Overlapping tags
    const tags1 = new Set(article1.tags);
    const tags2 = new Set(article2.tags);
    const tagOverlap = [...tags1].filter(tag => tags2.has(tag)).length;
    const maxTags = Math.max(tags1.size, tags2.size);
    if (maxTags > 0) score += (tagOverlap / maxTags) * 0.3;
    
    return Math.min(score, 1.0);
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
        }
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
        
        // Store embedding
        await this.dbManager.insertEmbedding({
          articleId: article._id,
          vector: vector,
          model: config.deduplication.semanticModel,
          textLength: text.length
        });
        
        return vector;
      }
      
      return embedding.vector;
      
    } catch (error) {
      logger.warn('⚠️  Failed to get/generate embedding:', error.message);
      return null;
    }
  }

  // Helper methods
  normalizeText(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  preprocessContent(content) {
    if (!content) return '';
    
    // Remove stop words and stem
    const words = this.normalizeText(content).split(' ');
    const filteredWords = stopword.removeStopwords(words);
    return filteredWords.map(word => stemmer(word)).join(' ');
  }

  jaccardSimilarity(text1, text2) {
    const set1 = new Set(text1.split(' '));
    const set2 = new Set(text2.split(' '));
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
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

  determinePrimaryMethod(scores) {
    if (scores.contentHash === 1.0) return 'content_hash';
    if (scores.titleSimilarity > 0.9) return 'title_similarity';
    if (scores.semanticSimilarity > 0.85) return 'semantic_similarity';
    if (scores.entitySimilarity > 0.8) return 'entity_similarity';
    return 'content_similarity';
  }

  async performLLMValidation(article1, article2, similarityScore) {
    try {
      if (similarityScore < 0.7) return false; // Only validate high-confidence matches
      
      const validation = await this.llmAnalyzer.validateDuplicate(article1, article2);
      return validation.isDuplicate && validation.confidence > this.thresholds.llmValidation;
      
    } catch (error) {
      logger.warn('⚠️  LLM validation failed:', error.message);
      return false;
    }
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

  // Advanced duplicate detection for edge cases
  async detectFollowUpStories(article) {
    // Detect if this is a follow-up to an existing story
    const keywords = this.extractKeywords(article.title + ' ' + article.content);
    
    const query = {
      publishedAt: { 
        $gte: new Date(Date.now() - this.timeWindow),
        $lt: new Date(article.publishedAt)
      },
      $text: { $search: keywords.slice(0, 5).join(' ') }
    };
    
    const potentialOriginals = await this.dbManager.findArticles(query, {
      sort: { publishedAt: 1 },
      limit: 10
    });
    
    return potentialOriginals;
  }

  extractKeywords(text) {
    const words = this.preprocessContent(text).split(' ');
    const wordFreq = {};
    
    words.forEach(word => {
      if (word.length > 3) {
        wordFreq[word] = (wordFreq[word] || 0) + 1;
      }
    });
    
    return Object.entries(wordFreq)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([word]) => word);
  }
}

module.exports = DeduplicationEngine;