const OpenAI = require('openai');
const logger = require('./logger');
const config = require('../config/config');

class LLMAnalyzer {
  constructor() {
    this.openai = null;
    this.anthropic = null;
    this.initialized = false;
  }

  async initialize() {
    try {
      // Initialize OpenAI if API key is available
      if (config.ai.openai.apiKey && config.ai.openai.apiKey !== 'your_openai_api_key_here') {
        this.openai = new OpenAI({
          apiKey: config.ai.openai.apiKey,
        });
        logger.info('✅ OpenAI initialized');
      }

      // Initialize Anthropic if available
      if (config.ai.anthropic.apiKey && config.ai.anthropic.apiKey !== 'your_anthropic_api_key_here') {
        const { Anthropic } = require('@anthropic-ai/sdk');
        this.anthropic = new Anthropic({
          apiKey: config.ai.anthropic.apiKey,
        });
        logger.info('✅ Anthropic initialized');
      }

      this.initialized = true;
      logger.info('🤖 LLM Analyzer initialized');
      
    } catch (error) {
      logger.warn('⚠️  LLM Analyzer initialization failed:', error.message);
      this.initialized = false;
    }
  }

  async validateDuplicate(article1, article2) {
    if (!this.initialized || (!this.openai && !this.anthropic)) {
      return this.getMockValidation(article1, article2);
    }

    try {
      const prompt = this.buildDuplicateValidationPrompt(article1, article2);
      
      let response;
      if (this.openai) {
        response = await this.callOpenAI(prompt);
      } else if (this.anthropic) {
        response = await this.callAnthropic(prompt);
      }

      return this.parseValidationResponse(response);
      
    } catch (error) {
      logger.warn('⚠️  LLM duplicate validation failed:', error.message);
      return this.getMockValidation(article1, article2);
    }
  }

  async analyzeContent(article) {
    if (!this.initialized || (!this.openai && !this.anthropic)) {
      return this.getMockAnalysis(article);
    }

    try {
      const prompt = this.buildContentAnalysisPrompt(article);
      
      let response;
      if (this.openai) {
        response = await this.callOpenAI(prompt);
      } else if (this.anthropic) {
        response = await this.callAnthropic(prompt);
      }

      return this.parseAnalysisResponse(response);
      
    } catch (error) {
      logger.warn('⚠️  LLM content analysis failed:', error.message);
      return this.getMockAnalysis(article);
    }
  }

  async generateSummary(content, maxLength = 200) {
    if (!this.initialized || (!this.openai && !this.anthropic)) {
      return this.getMockSummary(content, maxLength);
    }

    try {
      const prompt = `Please provide a concise summary of the following article in no more than ${maxLength} characters:

${content}

Summary:`;

      let response;
      if (this.openai) {
        response = await this.callOpenAI(prompt, 150);
      } else if (this.anthropic) {
        response = await this.callAnthropic(prompt, 150);
      }

      return response.trim();
      
    } catch (error) {
      logger.warn('⚠️  LLM summary generation failed:', error.message);
      return this.getMockSummary(content, maxLength);
    }
  }

  buildDuplicateValidationPrompt(article1, article2) {
    return `You are an expert news analyst. Please analyze these two news articles and determine if they are covering the same story.

Article 1:
Title: ${article1.title}
Source: ${article1.source}
Published: ${article1.publishedAt}
Content: ${(article1.content || article1.summary || '').substring(0, 1000)}

Article 2:
Title: ${article2.title}
Source: ${article2.source}
Published: ${article2.publishedAt}
Content: ${(article2.content || article2.summary || '').substring(0, 1000)}

Please respond with a JSON object in this exact format:
{
  "isDuplicate": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation",
  "category": "identical/similar/related/different"
}

Consider these factors:
- Are they reporting the same event/news?
- Do they share the same key facts?
- Are the main subjects/entities the same?
- Is the timing and context similar?

Articles about the same topic but with different angles or updates may not be duplicates.`;
  }

  buildContentAnalysisPrompt(article) {
    return `Analyze this news article and provide insights:

Title: ${article.title}
Source: ${article.source}
Content: ${(article.content || article.summary || '').substring(0, 1500)}

Please respond with a JSON object:
{
  "sentiment": "positive/negative/neutral",
  "category": "technology/business/politics/sports/entertainment/other",
  "importance": 0.0-1.0,
  "keyTopics": ["topic1", "topic2", "topic3"],
  "summary": "brief summary in 1-2 sentences",
  "businessImpact": "low/medium/high"
}`;
  }

  async callOpenAI(prompt, maxTokens = 500) {
    const completion = await this.openai.chat.completions.create({
      model: config.ai.openai.model,
      messages: [
        { role: 'user', content: prompt }
      ],
      max_tokens: maxTokens,
      temperature: config.ai.openai.temperature,
    });

    return completion.choices[0].message.content;
  }

  async callAnthropic(prompt, maxTokens = 500) {
    const completion = await this.anthropic.messages.create({
      model: config.ai.anthropic.model,
      max_tokens: maxTokens,
      messages: [
        { role: 'user', content: prompt }
      ],
    });

    return completion.content[0].text;
  }

  parseValidationResponse(response) {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          isDuplicate: Boolean(parsed.isDuplicate),
          confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
          reasoning: parsed.reasoning || 'No reasoning provided',
          category: parsed.category || 'unknown'
        };
      }
    } catch (error) {
      logger.warn('Failed to parse LLM validation response:', error.message);
    }

    // Fallback parsing
    const isDuplicate = response.toLowerCase().includes('true') || 
                       response.toLowerCase().includes('duplicate');
    
    return {
      isDuplicate,
      confidence: isDuplicate ? 0.7 : 0.3,
      reasoning: 'Parsed from text response',
      category: 'unknown'
    };
  }

  parseAnalysisResponse(response) {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          sentiment: parsed.sentiment || 'neutral',
          category: parsed.category || 'other',
          importance: Math.max(0, Math.min(1, parsed.importance || 0.5)),
          keyTopics: Array.isArray(parsed.keyTopics) ? parsed.keyTopics : [],
          summary: parsed.summary || 'No summary available',
          businessImpact: parsed.businessImpact || 'low'
        };
      }
    } catch (error) {
      logger.warn('Failed to parse LLM analysis response:', error.message);
    }

    return {
      sentiment: 'neutral',
      category: 'other',
      importance: 0.5,
      keyTopics: [],
      summary: 'Analysis not available',
      businessImpact: 'low'
    };
  }

  // Mock responses for when LLM is not available
  getMockValidation(article1, article2) {
    // Simple mock logic based on title similarity
    const title1 = article1.title.toLowerCase();
    const title2 = article2.title.toLowerCase();
    
    const words1 = new Set(title1.split(' ').filter(w => w.length > 3));
    const words2 = new Set(title2.split(' ').filter(w => w.length > 3));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const similarity = intersection.size / Math.max(words1.size, words2.size);
    
    return {
      isDuplicate: similarity > 0.6,
      confidence: similarity,
      reasoning: 'Mock analysis based on title similarity',
      category: similarity > 0.8 ? 'similar' : similarity > 0.6 ? 'related' : 'different'
    };
  }

  getMockAnalysis(article) {
    const title = article.title.toLowerCase();
    const content = (article.content || article.summary || '').toLowerCase();
    const text = title + ' ' + content;
    
    // Simple keyword-based analysis
    let sentiment = 'neutral';
    let category = 'other';
    let importance = 0.5;
    let businessImpact = 'low';
    
    // Sentiment analysis
    const positiveWords = ['growth', 'success', 'profit', 'gain', 'win', 'up', 'rise'];
    const negativeWords = ['loss', 'drop', 'fall', 'decline', 'crisis', 'fail', 'down'];
    
    const positiveCount = positiveWords.filter(word => text.includes(word)).length;
    const negativeCount = negativeWords.filter(word => text.includes(word)).length;
    
    if (positiveCount > negativeCount) sentiment = 'positive';
    else if (negativeCount > positiveCount) sentiment = 'negative';
    
    // Category analysis
    if (text.includes('tech') || text.includes('software') || text.includes('ai')) category = 'technology';
    else if (text.includes('business') || text.includes('company') || text.includes('market')) category = 'business';
    else if (text.includes('political') || text.includes('government') || text.includes('election')) category = 'politics';
    
    // Business impact
    if (text.includes('billion') || text.includes('merger') || text.includes('acquisition')) {
      businessImpact = 'high';
      importance = 0.8;
    } else if (text.includes('million') || text.includes('investment') || text.includes('funding')) {
      businessImpact = 'medium';
      importance = 0.6;
    }
    
    return {
      sentiment,
      category,
      importance,
      keyTopics: this.extractKeywords(text),
      summary: this.getMockSummary(article.content || article.summary, 150),
      businessImpact
    };
  }

  getMockSummary(content, maxLength) {
    if (!content) return 'No content available for summary';
    
    // Simple extractive summary - take first sentence and most important sentences
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);
    
    if (sentences.length === 0) return content.substring(0, maxLength);
    if (sentences.length === 1) return sentences[0].trim().substring(0, maxLength);
    
    // Take first sentence and try to add more up to maxLength
    let summary = sentences[0].trim();
    
    for (let i = 1; i < sentences.length && summary.length < maxLength - 50; i++) {
      const nextSentence = sentences[i].trim();
      if (summary.length + nextSentence.length < maxLength) {
        summary += '. ' + nextSentence;
      }
    }
    
    return summary.substring(0, maxLength);
  }

  extractKeywords(text) {
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3);
    
    const frequency = {};
    words.forEach(word => {
      frequency[word] = (frequency[word] || 0) + 1;
    });
    
    return Object.entries(frequency)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([word]) => word);
  }

  // Check if LLM services are available
  isAvailable() {
    return this.initialized && (this.openai || this.anthropic);
  }

  getAvailableProviders() {
    const providers = [];
    if (this.openai) providers.push('openai');
    if (this.anthropic) providers.push('anthropic');
    return providers;
  }
}

module.exports = LLMAnalyzer;