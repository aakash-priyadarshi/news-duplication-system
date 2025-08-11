const compromise = require('compromise');
const logger = require('./logger');

class EntityExtractor {
  constructor() {
    this.patterns = {
      // Company patterns
      companies: [
        /\b([A-Z][a-z]+ (?:Inc|Corp|Corporation|Company|Co|Ltd|LLC|LP|LLP|Holdings|Group|Enterprises|Systems|Technologies|Tech|Solutions|Services|Partners|Capital|Ventures|Industries|International|Global|Worldwide)\.?)\b/g,
        /\b([A-Z][a-z]+(?:[A-Z][a-z]*)*)\s+(?:Inc|Corp|Corporation|Company|Co|Ltd|LLC)\b/g
      ],
      
      // Money amounts
      money: [
        /\$[\d,]+(?:\.\d{2})?(?:\s*(?:million|billion|trillion|M|B|T))?/gi,
        /(?:USD|EUR|GBP|JPY)\s*[\d,]+(?:\.\d{2})?/gi
      ],
      
      // Percentages
      percentages: /\d+(?:\.\d+)?%/g,
      
      // URLs
      urls: /https?:\/\/[^\s]+/g,
      
      // Stock symbols
      stocks: /\b[A-Z]{2,5}(?:\.[A-Z]{1,2})?\b/g,
      
      // Dates
      dates: [
        /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/gi,
        /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g,
        /\b\d{4}-\d{2}-\d{2}\b/g
      ]
    };
    
    // Known company indicators
    this.companyIndicators = new Set([
      'inc', 'corp', 'corporation', 'company', 'co', 'ltd', 'llc', 'lp', 'llp',
      'holdings', 'group', 'enterprises', 'systems', 'technologies', 'tech',
      'solutions', 'services', 'partners', 'capital', 'ventures', 'industries',
      'international', 'global', 'worldwide'
    ]);
    
    // Common non-company proper nouns to filter out
    this.excludePatterns = new Set([
      'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
      'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
      'september', 'october', 'november', 'december', 'america', 'american',
      'europe', 'european', 'asia', 'asian', 'africa', 'african'
    ]);
  }

  async extract(text) {
    if (!text || typeof text !== 'string') {
      return [];
    }

    try {
      const entities = [];
      
      // Use compromise for basic NLP
      const doc = compromise(text);
      
      // Extract different types of entities
      entities.push(...this.extractPeople(doc));
      entities.push(...this.extractPlaces(doc));
      entities.push(...this.extractOrganizations(doc));
      entities.push(...this.extractCompanies(text));
      entities.push(...this.extractMoney(text));
      entities.push(...this.extractPercentages(text));
      entities.push(...this.extractDates(text));
      entities.push(...this.extractStockSymbols(text));
      
      // Remove duplicates and filter
      return this.filterAndDeduplicate(entities);
      
    } catch (error) {
      logger.warn('Entity extraction failed:', error.message);
      return [];
    }
  }

  extractPeople(doc) {
    const people = doc.people().out('array');
    return people.map(name => ({
      name: name.trim(),
      type: 'PERSON',
      confidence: 0.8
    }));
  }

  extractPlaces(doc) {
    const places = doc.places().out('array');
    return places.map(place => ({
      name: place.trim(),
      type: 'LOCATION',
      confidence: 0.7
    }));
  }

  extractOrganizations(doc) {
    const orgs = doc.organizations().out('array');
    return orgs.map(org => ({
      name: org.trim(),
      type: 'ORGANIZATION',
      confidence: 0.75
    }));
  }

  extractCompanies(text) {
    const companies = [];
    
    for (const pattern of this.patterns.companies) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const company = match[1] || match[0];
        if (company && company.length > 2) {
          companies.push({
            name: company.trim(),
            type: 'COMPANY',
            confidence: 0.85
          });
        }
      }
    }
    
    return companies;
  }

  extractMoney(text) {
    const amounts = [];
    
    for (const pattern of this.patterns.money) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        amounts.push({
          name: match[0],
          type: 'MONEY',
          confidence: 0.9
        });
      }
    }
    
    return amounts;
  }

  extractPercentages(text) {
    const percentages = [];
    let match;
    
    while ((match = this.patterns.percentages.exec(text)) !== null) {
      percentages.push({
        name: match[0],
        type: 'PERCENTAGE',
        confidence: 0.95
      });
    }
    
    return percentages;
  }

  extractDates(text) {
    const dates = [];
    
    for (const pattern of this.patterns.dates) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        dates.push({
          name: match[0],
          type: 'DATE',
          confidence: 0.8
        });
      }
    }
    
    return dates;
  }

  extractStockSymbols(text) {
    const stocks = [];
    let match;
    
    // Only extract potential stock symbols in financial context
    if (this.hasFinancialContext(text)) {
      while ((match = this.patterns.stocks.exec(text)) !== null) {
        const symbol = match[0];
        if (this.isLikelyStockSymbol(symbol, text)) {
          stocks.push({
            name: symbol,
            type: 'STOCK_SYMBOL',
            confidence: 0.7
          });
        }
      }
    }
    
    return stocks;
  }

  hasFinancialContext(text) {
    const financialTerms = [
      'stock', 'shares', 'trading', 'market', 'nasdaq', 'nyse', 'exchange',
      'investor', 'investment', 'portfolio', 'earnings', 'revenue', 'profit'
    ];
    
    const lowerText = text.toLowerCase();
    return financialTerms.some(term => lowerText.includes(term));
  }

  isLikelyStockSymbol(symbol, text) {
    // Filter out common false positives
    const falsePossibilities = ['THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN', 'HER', 'WAS', 'ONE', 'OUR', 'OUT', 'DAY', 'GET', 'USE', 'MAN', 'NEW', 'NOW', 'WAY', 'MAY', 'SAY'];
    
    if (falsePossibilities.includes(symbol)) {
      return false;
    }
    
    // Check if it appears in financial context
    const contextWindow = 50;
    const symbolIndex = text.indexOf(symbol);
    const start = Math.max(0, symbolIndex - contextWindow);
    const end = Math.min(text.length, symbolIndex + symbol.length + contextWindow);
    const context = text.substring(start, end).toLowerCase();
    
    const stockIndicators = ['trading', 'shares', 'stock', 'ticker', 'nasdaq', 'nyse', '$'];
    return stockIndicators.some(indicator => context.includes(indicator));
  }

  filterAndDeduplicate(entities) {
    // Remove duplicates based on name and type
    const seen = new Set();
    const filtered = [];
    
    for (const entity of entities) {
      const key = `${entity.name.toLowerCase()}-${entity.type}`;
      
      if (!seen.has(key) && this.isValidEntity(entity)) {
        seen.add(key);
        filtered.push(entity);
      }
    }
    
    // Sort by confidence and limit results
    return filtered
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 50); // Limit to top 50 entities
  }

  isValidEntity(entity) {
    const name = entity.name.toLowerCase().trim();
    
    // Skip very short names
    if (name.length < 2) return false;
    
    // Skip common words that aren't entities
    if (this.excludePatterns.has(name)) return false;
    
    // Skip purely numeric values (unless they're money/percentages)
    if (/^\d+$/.test(name) && !['MONEY', 'PERCENTAGE'].includes(entity.type)) {
      return false;
    }
    
    // Skip single letters
    if (name.length === 1) return false;
    
    return true;
  }

  // Get entities grouped by type
  getEntitiesByType(entities) {
    const grouped = {};
    
    for (const entity of entities) {
      if (!grouped[entity.type]) {
        grouped[entity.type] = [];
      }
      grouped[entity.type].push(entity);
    }
    
    return grouped;
  }

  // Extract key entities for similarity comparison
  getKeyEntities(entities, maxPerType = 5) {
    const grouped = this.getEntitiesByType(entities);
    const key = {};
    
    for (const [type, typeEntities] of Object.entries(grouped)) {
      key[type] = typeEntities
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, maxPerType);
    }
    
    return key;
  }

  // Calculate entity overlap between two articles
  calculateEntityOverlap(entities1, entities2) {
    const names1 = new Set(entities1.map(e => e.name.toLowerCase()));
    const names2 = new Set(entities2.map(e => e.name.toLowerCase()));
    
    const intersection = new Set([...names1].filter(x => names2.has(x)));
    const union = new Set([...names1, ...names2]);
    
    return {
      jaccardSimilarity: intersection.size / union.size,
      commonEntities: intersection.size,
      totalUniqueEntities: union.size,
      overlap: Array.from(intersection)
    };
  }
}

module.exports = EntityExtractor;