const logger = require('./logger');
const config = require('../config/config');

class ClusteringEngine {
  constructor() {
    this.clusters = new Map();
    this.initialized = false;
    this.clusterStats = {
      totalClusters: 0,
      totalArticles: 0,
      averageClusterSize: 0
    };
  }

  async initialize() {
    this.initialized = true;
    logger.info('🔗 Clustering engine initialized');
  }

  async updateClusters(article, duplicates) {
    try {
      if (duplicates.length === 0) {
        // Create new cluster for unique article
        await this.createNewCluster(article);
      } else {
        // Add to existing cluster or merge clusters
        await this.addToCluster(article, duplicates);
      }
      
      this.updateStats();
      
    } catch (error) {
      logger.warn('Failed to update clusters:', error.message);
    }
  }

  async createNewCluster(article) {
    const clusterId = this.generateClusterId();
    const cluster = {
      id: clusterId,
      articles: [article._id],
      centroid: await this.calculateCentroid([article]),
      created: new Date(),
      updated: new Date(),
      tags: [...(article.tags || [])],
      category: article.category,
      sources: [article.source]
    };
    
    this.clusters.set(clusterId, cluster);
    logger.debug(`Created new cluster ${clusterId} for article: ${article.title}`);
  }

  async addToCluster(article, duplicates) {
    // Find the cluster of the first duplicate
    const firstDuplicate = duplicates[0].article;
    const clusterId = this.findClusterByArticle(firstDuplicate._id);
    
    if (clusterId) {
      const cluster = this.clusters.get(clusterId);
      
      // Add article to existing cluster
      if (!cluster.articles.includes(article._id)) {
        cluster.articles.push(article._id);
        cluster.updated = new Date();
        
        // Update cluster metadata
        this.updateClusterMetadata(cluster, article);
        
        // Recalculate centroid
        cluster.centroid = await this.calculateCentroid([article, firstDuplicate]);
        
        logger.debug(`Added article to cluster ${clusterId}: ${article.title}`);
      }
    } else {
      // Create new cluster if none found
      await this.createNewCluster(article);
    }
  }

  findClusterByArticle(articleId) {
    for (const [clusterId, cluster] of this.clusters.entries()) {
      if (cluster.articles.includes(articleId)) {
        return clusterId;
      }
    }
    return null;
  }

  updateClusterMetadata(cluster, newArticle) {
    // Merge tags
    if (newArticle.tags) {
      const existingTags = new Set(cluster.tags);
      newArticle.tags.forEach(tag => existingTags.add(tag));
      cluster.tags = Array.from(existingTags);
    }
    
    // Add source if not already present
    if (newArticle.source && !cluster.sources.includes(newArticle.source)) {
      cluster.sources.push(newArticle.source);
    }
    
    // Update category if not set or if new article has higher priority
    if (!cluster.category || this.getCategoryPriority(newArticle.category) > this.getCategoryPriority(cluster.category)) {
      cluster.category = newArticle.category;
    }
  }

  getCategoryPriority(category) {
    const priorities = {
      'breaking': 10,
      'business': 8,
      'technology': 7,
      'politics': 6,
      'sports': 5,
      'entertainment': 4,
      'other': 1
    };
    return priorities[category] || 1;
  }

  async calculateCentroid(articles) {
    // Simple centroid calculation based on article features
    if (!articles || articles.length === 0) return null;
    
    const features = {
      avgWordCount: 0,
      avgEntityCount: 0,
      commonCategories: [],
      commonTags: [],
      sourceDistribution: {},
      avgPublishTime: 0
    };
    
    let totalWordCount = 0;
    let totalEntityCount = 0;
    let publishTimes = [];
    const allCategories = [];
    const allTags = [];
    
    for (const article of articles) {
      // Word count
      if (article.content) {
        const wordCount = article.content.split(/\s+/).length;
        totalWordCount += wordCount;
      }
      
      // Entity count
      if (article.entities) {
        totalEntityCount += article.entities.length;
      }
      
      // Categories and tags
      if (article.category) allCategories.push(article.category);
      if (article.tags) allTags.push(...article.tags);
      
      // Source distribution
      if (article.source) {
        features.sourceDistribution[article.source] = 
          (features.sourceDistribution[article.source] || 0) + 1;
      }
      
      // Publish time
      if (article.publishedAt) {
        publishTimes.push(new Date(article.publishedAt).getTime());
      }
    }
    
    // Calculate averages
    features.avgWordCount = totalWordCount / articles.length;
    features.avgEntityCount = totalEntityCount / articles.length;
    features.avgPublishTime = publishTimes.reduce((a, b) => a + b, 0) / publishTimes.length;
    
    // Find common categories and tags
    features.commonCategories = this.findMostCommon(allCategories);
    features.commonTags = this.findMostCommon(allTags);
    
    return features;
  }

  findMostCommon(items) {
    const frequency = {};
    items.forEach(item => {
      frequency[item] = (frequency[item] || 0) + 1;
    });
    
    return Object.entries(frequency)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([item]) => item);
  }

  generateClusterId() {
    return `cluster_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Get clusters that might contain duplicates of a new article
  async findCandidateClusters(article) {
    const candidates = [];
    const currentTime = new Date();
    const timeWindow = config.deduplication.timeWindowHours * 60 * 60 * 1000;
    
    for (const [clusterId, cluster] of this.clusters.entries()) {
      // Skip clusters outside time window
      if (currentTime - cluster.updated > timeWindow) {
        continue;
      }
      
      // Calculate similarity to cluster
      const similarity = this.calculateClusterSimilarity(article, cluster);
      
      if (similarity > 0.3) { // Threshold for candidate clusters
        candidates.push({
          clusterId,
          cluster,
          similarity
        });
      }
    }
    
    return candidates.sort((a, b) => b.similarity - a.similarity);
  }

  calculateClusterSimilarity(article, cluster) {
    let similarity = 0;
    let factors = 0;
    
    // Category similarity
    if (article.category === cluster.category) {
      similarity += 0.3;
    }
    factors++;
    
    // Tag overlap
    if (article.tags && cluster.tags) {
      const articleTags = new Set(article.tags);
      const clusterTags = new Set(cluster.tags);
      const intersection = new Set([...articleTags].filter(x => clusterTags.has(x)));
      const union = new Set([...articleTags, ...clusterTags]);
      
      if (union.size > 0) {
        similarity += (intersection.size / union.size) * 0.4;
      }
    }
    factors++;
    
    // Source similarity
    if (article.source && cluster.sources.includes(article.source)) {
      similarity += 0.2;
    }
    factors++;
    
    // Time proximity (newer clusters get higher similarity)
    const timeDiff = Math.abs(new Date() - cluster.updated);
    const timeScore = Math.max(0, 1 - (timeDiff / (24 * 60 * 60 * 1000))); // 24 hours decay
    similarity += timeScore * 0.1;
    factors++;
    
    return similarity / factors;
  }

  // Clean up old clusters
  async cleanupOldClusters() {
    const currentTime = new Date();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
    let removedCount = 0;
    
    for (const [clusterId, cluster] of this.clusters.entries()) {
      if (currentTime - cluster.created > maxAge) {
        this.clusters.delete(clusterId);
        removedCount++;
      }
    }
    
    if (removedCount > 0) {
      logger.info(`Cleaned up ${removedCount} old clusters`);
      this.updateStats();
    }
  }

  updateStats() {
    this.clusterStats.totalClusters = this.clusters.size;
    this.clusterStats.totalArticles = Array.from(this.clusters.values())
      .reduce((sum, cluster) => sum + cluster.articles.length, 0);
    this.clusterStats.averageClusterSize = this.clusterStats.totalClusters > 0 
      ? this.clusterStats.totalArticles / this.clusterStats.totalClusters 
      : 0;
  }

  // Get cluster information
  getClusterInfo(clusterId) {
    return this.clusters.get(clusterId);
  }

  // Get all clusters
  getAllClusters() {
    return Array.from(this.clusters.values());
  }

  // Get clusters by category
  getClustersByCategory(category) {
    return Array.from(this.clusters.values())
      .filter(cluster => cluster.category === category);
  }

  // Get cluster statistics
  getStats() {
    return {
      ...this.clusterStats,
      isInitialized: this.initialized,
      activeTimeWindow: config.deduplication.timeWindowHours + ' hours'
    };
  }

  // Export clusters for analysis
  exportClusters() {
    const clusters = [];
    
    for (const [clusterId, cluster] of this.clusters.entries()) {
      clusters.push({
        id: clusterId,
        articleCount: cluster.articles.length,
        category: cluster.category,
        sources: cluster.sources,
        tags: cluster.tags,
        created: cluster.created,
        updated: cluster.updated,
        centroid: cluster.centroid
      });
    }
    
    return clusters;
  }

  // Merge two clusters
  async mergeClusters(clusterId1, clusterId2) {
    const cluster1 = this.clusters.get(clusterId1);
    const cluster2 = this.clusters.get(clusterId2);
    
    if (!cluster1 || !cluster2) {
      logger.warn('Cannot merge clusters: one or both not found');
      return false;
    }
    
    // Merge into cluster1
    cluster1.articles.push(...cluster2.articles);
    cluster1.sources = [...new Set([...cluster1.sources, ...cluster2.sources])];
    cluster1.tags = [...new Set([...cluster1.tags, ...cluster2.tags])];
    cluster1.updated = new Date();
    
    // Remove cluster2
    this.clusters.delete(clusterId2);
    
    logger.info(`Merged cluster ${clusterId2} into ${clusterId1}`);
    this.updateStats();
    
    return true;
  }

  // Find clusters that should be merged
  async findMergeCandidates(threshold = 0.8) {
    const candidates = [];
    const clusterArray = Array.from(this.clusters.entries());
    
    for (let i = 0; i < clusterArray.length; i++) {
      for (let j = i + 1; j < clusterArray.length; j++) {
        const [id1, cluster1] = clusterArray[i];
        const [id2, cluster2] = clusterArray[j];
        
        const similarity = this.calculateClusterToClusterSimilarity(cluster1, cluster2);
        
        if (similarity > threshold) {
          candidates.push({
            cluster1: id1,
            cluster2: id2,
            similarity
          });
        }
      }
    }
    
    return candidates.sort((a, b) => b.similarity - a.similarity);
  }

  calculateClusterToClusterSimilarity(cluster1, cluster2) {
    let similarity = 0;
    let factors = 0;
    
    // Category match
    if (cluster1.category === cluster2.category) {
      similarity += 0.4;
    }
    factors++;
    
    // Source overlap
    const sources1 = new Set(cluster1.sources);
    const sources2 = new Set(cluster2.sources);
    const sourceIntersection = new Set([...sources1].filter(x => sources2.has(x)));
    const sourceUnion = new Set([...sources1, ...sources2]);
    
    if (sourceUnion.size > 0) {
      similarity += (sourceIntersection.size / sourceUnion.size) * 0.3;
    }
    factors++;
    
    // Tag overlap
    const tags1 = new Set(cluster1.tags);
    const tags2 = new Set(cluster2.tags);
    const tagIntersection = new Set([...tags1].filter(x => tags2.has(x)));
    const tagUnion = new Set([...tags1, ...tags2]);
    
    if (tagUnion.size > 0) {
      similarity += (tagIntersection.size / tagUnion.size) * 0.3;
    }
    factors++;
    
    return similarity / factors;
  }
}

module.exports = ClusteringEngine;