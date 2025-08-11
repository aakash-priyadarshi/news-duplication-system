const EventEmitter = require('events');
const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config/config');

class AlertManager extends EventEmitter {
  constructor() {
    super();
    this.dbManager = null;
    this.alertQueue = [];
    this.isProcessing = false;
    this.alertHistory = new Map();
    this.cooldownPeriod = config.alerts.cooldownMinutes * 60 * 1000;
    this.maxAlertsPerHour = config.alerts.maxAlertsPerHour;
    
    this.stats = {
      totalAlerts: 0,
      successfulAlerts: 0,
      failedAlerts: 0,
      filteredAlerts: 0,
      lastAlertSent: null
    };
  }

  async initialize(dbManager) {
    this.dbManager = dbManager;
    
    // Start alert processing
    this.startAlertProcessor();
    
    logger.info('📢 Alert manager initialized');
  }

  startAlertProcessor() {
    // Process alert queue every 5 seconds
    setInterval(() => {
      if (!this.isProcessing && this.alertQueue.length > 0) {
        this.processAlertQueue();
      }
    }, 5000);
    
    // Clean up old alert history every hour
    setInterval(() => {
      this.cleanupAlertHistory();
    }, 60 * 60 * 1000);
  }

  async processAlert(article) {
    try {
      // Check if alert should be sent
      if (!this.shouldSendAlert(article)) {
        this.stats.filteredAlerts++;
        logger.debug(`Alert filtered for article: ${article.title}`);
        return;
      }
      
      // Create alert object
      const alert = {
        id: this.generateAlertId(),
        articleId: article._id,
        title: article.title,
        summary: article.summary || this.generateSummary(article),
        source: article.source,
        category: article.category,
        priority: this.calculatePriority(article),
        url: article.url,
        publishedAt: article.publishedAt,
        entities: article.entities || [],
        tags: article.tags || [],
        createdAt: new Date(),
        channels: this.determineChannels(article),
        status: 'pending'
      };
      
      // Add to queue
      this.alertQueue.push(alert);
      this.stats.totalAlerts++;
      
      logger.debug(`Alert queued: ${alert.title}`);
      
    } catch (error) {
      logger.error('Failed to process alert:', error);
    }
  }

  shouldSendAlert(article) {
    // Check rate limiting
    if (!this.checkRateLimit()) {
      return false;
    }
    
    // Check cooldown for similar articles
    if (this.isInCooldown(article)) {
      return false;
    }
    
    // Check article quality/importance
    if (!this.meetsQualityThreshold(article)) {
      return false;
    }
    
    return true;
  }

  checkRateLimit() {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    // Count alerts sent in the last hour
    let recentAlerts = 0;
    for (const [alertKey, alertTime] of this.alertHistory.entries()) {
      if (alertTime > oneHourAgo) {
        recentAlerts++;
      }
    }
    
    return recentAlerts < this.maxAlertsPerHour;
  }

  isInCooldown(article) {
    const now = new Date();
    const articleKey = this.generateArticleKey(article);
    
    // Check if we've sent an alert for a similar article recently
    for (const [alertKey, alertTime] of this.alertHistory.entries()) {
      if (alertKey.includes(articleKey) && (now - alertTime) < this.cooldownPeriod) {
        return true;
      }
    }
    
    return false;
  }

  meetsQualityThreshold(article) {
    let score = 0;
    
    // Content length
    const contentLength = (article.content || article.summary || '').length;
    if (contentLength > 500) score += 2;
    else if (contentLength > 200) score += 1;
    
    // Has entities
    if (article.entities && article.entities.length > 0) score += 1;
    
    // Priority category
    if (['business', 'technology', 'breaking'].includes(article.category)) score += 2;
    
    // Trusted source
    const trustedSources = ['Reuters', 'Bloomberg', 'TechCrunch', 'Wall Street Journal'];
    if (trustedSources.includes(article.source)) score += 1;
    
    // Recent article
    const ageHours = (new Date() - new Date(article.publishedAt)) / (1000 * 60 * 60);
    if (ageHours < 2) score += 1;
    
    return score >= 3; // Minimum quality threshold
  }

  calculatePriority(article) {
    let priority = 'medium';
    
    // Breaking news indicators
    const breakingKeywords = ['breaking', 'urgent', 'alert', 'developing'];
    const titleLower = article.title.toLowerCase();
    
    if (breakingKeywords.some(keyword => titleLower.includes(keyword))) {
      priority = 'high';
    }
    
    // Business impact indicators
    const highImpactKeywords = ['merger', 'acquisition', 'ipo', 'bankruptcy', 'ceo', 'funding'];
    if (highImpactKeywords.some(keyword => titleLower.includes(keyword))) {
      priority = 'high';
    }
    
    // Money amounts
    if (/(billion|\$[0-9]{1,}[0-9,]*million)/i.test(article.content || article.summary || '')) {
      priority = 'high';
    }
    
    // Category-based priority
    if (article.category === 'breaking') priority = 'high';
    else if (article.category === 'business') priority = 'medium';
    else if (article.category === 'entertainment') priority = 'low';
    
    return priority;
  }

  determineChannels(article) {
    const channels = [];
    
    // Always include webhook if enabled
    if (config.alerts.channels.webhook.enabled) {
      channels.push('webhook');
    }
    
    // Email for high priority
    if (config.alerts.channels.email.enabled && this.calculatePriority(article) === 'high') {
      channels.push('email');
    }
    
    // Slack for business/technology
    if (config.alerts.channels.slack.enabled && 
        ['business', 'technology'].includes(article.category)) {
      channels.push('slack');
    }
    
    return channels;
  }

  async processAlertQueue() {
    if (this.alertQueue.length === 0) return;
    
    this.isProcessing = true;
    
    try {
      const alert = this.alertQueue.shift();
      await this.sendAlert(alert);
    } catch (error) {
      logger.error('Alert queue processing failed:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  async sendAlert(alert) {
    logger.info(`📤 Sending alert: ${alert.title}`);
    
    const results = [];
    
    for (const channel of alert.channels) {
      try {
        let result;
        switch (channel) {
          case 'webhook':
            result = await this.sendWebhookAlert(alert);
            break;
          case 'email':
            result = await this.sendEmailAlert(alert);
            break;
          case 'slack':
            result = await this.sendSlackAlert(alert);
            break;
          default:
            result = { success: false, error: 'Unknown channel' };
        }
        
        results.push({ channel, ...result });
        
      } catch (error) {
        logger.error(`Failed to send alert via ${channel}:`, error);
        results.push({ channel, success: false, error: error.message });
      }
    }
    
    // Update alert status
    const successCount = results.filter(r => r.success).length;
    alert.status = successCount > 0 ? 'sent' : 'failed';
    alert.sentAt = new Date();
    alert.results = results;
    
    // Store in database
    await this.storeAlert(alert);
    
    // Update statistics
    if (successCount > 0) {
      this.stats.successfulAlerts++;
      this.stats.lastAlertSent = new Date();
    } else {
      this.stats.failedAlerts++;
    }
    
    // Track for cooldown
    this.trackAlert(alert);
    
    // Emit event
    this.emit('alertSent', {
      id: alert.id,
      title: alert.title,
      channels: alert.channels,
      success: successCount > 0,
      results
    });
    
    logger.info(`✅ Alert processed: ${successCount}/${alert.channels.length} channels succeeded`);
  }

  async sendWebhookAlert(alert) {
    if (!config.alerts.channels.webhook.url) {
      return { success: false, error: 'No webhook URL configured' };
    }
    
    const payload = {
      type: 'news_alert',
      alert: {
        id: alert.id,
        title: alert.title,
        summary: alert.summary,
        source: alert.source,
        category: alert.category,
        priority: alert.priority,
        url: alert.url,
        publishedAt: alert.publishedAt,
        entities: alert.entities.slice(0, 10), // Limit for payload size
        tags: alert.tags,
        createdAt: alert.createdAt
      },
      metadata: {
        system: 'news-deduplication',
        version: '1.0.0',
        timestamp: new Date().toISOString()
      }
    };
    
    try {
      const response = await axios.post(config.alerts.channels.webhook.url, payload, {
        timeout: config.alerts.channels.webhook.timeout || 10000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'News-Deduplication-System/1.0'
        }
      });
      
      return { 
        success: response.status >= 200 && response.status < 300,
        statusCode: response.status,
        response: response.data
      };
      
    } catch (error) {
      return { 
        success: false, 
        error: error.message,
        statusCode: error.response?.status
      };
    }
  }

  async sendEmailAlert(alert) {
    // Email implementation would go here
    // For now, return a mock success
    logger.info('📧 Email alert (mock): ' + alert.title);
    return { success: true, message: 'Email sent (mock)' };
  }

  async sendSlackAlert(alert) {
    if (!config.alerts.channels.slack.webhookUrl) {
      return { success: false, error: 'No Slack webhook URL configured' };
    }
    
    const slackPayload = {
      channel: config.alerts.channels.slack.channel,
      username: 'News Alert Bot',
      icon_emoji: ':newspaper:',
      attachments: [{
        color: this.getSlackColor(alert.priority),
        title: alert.title,
        title_link: alert.url,
        text: alert.summary,
        fields: [
          {
            title: 'Source',
            value: alert.source,
            short: true
          },
          {
            title: 'Category',
            value: alert.category,
            short: true
          },
          {
            title: 'Priority',
            value: alert.priority.toUpperCase(),
            short: true
          },
          {
            title: 'Published',
            value: new Date(alert.publishedAt).toLocaleString(),
            short: true
          }
        ],
        footer: 'News Deduplication System',
        ts: Math.floor(Date.now() / 1000)
      }]
    };
    
    try {
      const response = await axios.post(config.alerts.channels.slack.webhookUrl, slackPayload, {
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' }
      });
      
      return { success: response.status === 200 };
      
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  getSlackColor(priority) {
    switch (priority) {
      case 'high': return 'danger';
      case 'medium': return 'warning';
      case 'low': return 'good';
      default: return '#36a64f';
    }
  }

  async storeAlert(alert) {
    try {
      await this.dbManager.insertAlert(alert);
    } catch (error) {
      logger.error('Failed to store alert:', error);
    }
  }

  trackAlert(alert) {
    const alertKey = this.generateArticleKey({ 
      title: alert.title, 
      source: alert.source 
    });
    this.alertHistory.set(`${alert.id}_${alertKey}`, new Date());
  }

  generateAlertId() {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  generateArticleKey(article) {
    // Create a simple key based on title words and source
    const titleWords = article.title.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 3)
      .slice(0, 3)
      .join('_');
    
    return `${article.source}_${titleWords}`;
  }

  generateSummary(article) {
    const content = article.content || article.summary || article.title;
    if (content.length <= 200) return content;
    
    // Simple extractive summary
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);
    return sentences[0]?.trim().substring(0, 200) || content.substring(0, 200);
  }

  cleanupAlertHistory() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    let removed = 0;
    
    for (const [key, timestamp] of this.alertHistory.entries()) {
      if (timestamp < cutoff) {
        this.alertHistory.delete(key);
        removed++;
      }
    }
    
    if (removed > 0) {
      logger.debug(`Cleaned up ${removed} old alert history entries`);
    }
  }

  // Test alert functionality
  async sendTestAlert() {
    const testAlert = {
      id: this.generateAlertId(),
      title: 'Test Alert - System Check',
      summary: 'This is a test alert to verify the news deduplication system is working correctly.',
      source: 'System',
      category: 'test',
      priority: 'medium',
      url: 'http://localhost:3000',
      publishedAt: new Date(),
      entities: [],
      tags: ['test', 'system-check'],
      createdAt: new Date(),
      channels: this.determineChannels({ category: 'test' }),
      status: 'pending'
    };
    
    await this.sendAlert(testAlert);
    return testAlert;
  }

  // Get alert statistics
  getStats() {
    return {
      ...this.stats,
      queueSize: this.alertQueue.length,
      historySize: this.alertHistory.size,
      isProcessing: this.isProcessing,
      config: {
        cooldownMinutes: config.alerts.cooldownMinutes,
        maxAlertsPerHour: this.maxAlertsPerHour,
        enabledChannels: Object.entries(config.alerts.channels)
          .filter(([, channel]) => channel.enabled)
          .map(([name]) => name)
      }
    };
  }

  // Get recent alerts
  async getRecentAlerts(limit = 50) {
    try {
      return await this.dbManager.findAlerts(
        {},
        { sort: { createdAt: -1 }, limit }
      );
    } catch (error) {
      logger.error('Failed to get recent alerts:', error);
      return [];
    }
  }

  // Get alerts by status
  async getAlertsByStatus(status, limit = 20) {
    try {
      return await this.dbManager.findAlerts(
        { status },
        { sort: { createdAt: -1 }, limit }
      );
    } catch (error) {
      logger.error('Failed to get alerts by status:', error);
      return [];
    }
  }

  // Manual alert creation (for testing or manual triggers)
  async createManualAlert(alertData) {
    const alert = {
      id: this.generateAlertId(),
      ...alertData,
      createdAt: new Date(),
      status: 'pending',
      channels: alertData.channels || ['webhook']
    };
    
    this.alertQueue.push(alert);
    this.stats.totalAlerts++;
    
    return alert;
  }

  async stop() {
    this.isProcessing = false;
    this.alertQueue = [];
    logger.info('📢 Alert manager stopped');
  }
}

module.exports = AlertManager;