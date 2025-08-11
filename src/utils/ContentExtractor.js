const cheerio = require('cheerio');
const logger = require('./logger');

class ContentExtractor {
  constructor() {
    this.selectors = {
      // Common article content selectors
      content: [
        'article',
        '.article-content',
        '.post-content',
        '.entry-content',
        '.content',
        '.story-body',
        '.article-body',
        'main',
        '#content',
        '.main-content'
      ],
      
      // Elements to remove
      remove: [
        'script',
        'style',
        'nav',
        'header',
        'footer',
        '.advertisement',
        '.ads',
        '.sidebar',
        '.comments',
        '.social-share',
        '.related-articles',
        '.newsletter-signup'
      ],
      
      // Title selectors
      title: [
        'h1',
        '.article-title',
        '.post-title',
        '.entry-title',
        'title'
      ],
      
      // Author selectors
      author: [
        '.author',
        '.byline',
        '.article-author',
        '[rel="author"]',
        '.post-author'
      ],
      
      // Date selectors
      date: [
        '.publish-date',
        '.article-date',
        '.post-date',
        'time[datetime]',
        '.date'
      ]
    };
  }

  async extract(html, url) {
    try {
      const $ = cheerio.load(html);
      
      // Remove unwanted elements
      this.removeUnwantedElements($);
      
      // Extract content
      const content = this.extractMainContent($);
      const title = this.extractTitle($);
      const author = this.extractAuthor($);
      const publishDate = this.extractPublishDate($);
      const images = this.extractImages($, url);
      const links = this.extractLinks($, url);
      
      return {
        content: this.cleanText(content),
        title: this.cleanText(title),
        author: this.cleanText(author),
        publishDate,
        images,
        links,
        wordCount: this.countWords(content),
        readingTime: this.estimateReadingTime(content)
      };
      
    } catch (error) {
      logger.error('Content extraction failed:', error);
      return null;
    }
  }

  removeUnwantedElements($) {
    // Remove script, style, and other unwanted elements
    this.selectors.remove.forEach(selector => {
      $(selector).remove();
    });
    
    // Remove elements with common ad/tracking attributes
    $('[class*="ad"]').remove();
    $('[id*="ad"]').remove();
    $('[class*="tracking"]').remove();
    $('[class*="analytics"]').remove();
  }

  extractMainContent($) {
    // Try each content selector until we find substantial content
    for (const selector of this.selectors.content) {
      const element = $(selector).first();
      if (element.length > 0) {
        const text = element.text().trim();
        if (text.length > 100) { // Minimum content length
          return this.processContentElement($, element);
        }
      }
    }
    
    // Fallback: try to find the largest text block
    return this.findLargestTextBlock($);
  }

  processContentElement($, element) {
    // Fixed: Pass $ as parameter and use it directly
    const $element = $(element);
    
    // Remove nested unwanted elements
    $element.find(this.selectors.remove.join(',')).remove();
    
    // Convert to plain text while preserving paragraph breaks
    let content = '';
    $element.find('p, div, h1, h2, h3, h4, h5, h6').each((i, el) => {
      const text = $(el).text().trim();
      if (text) {
        content += text + '\n\n';
      }
    });
    
    // If no structured content found, get all text
    if (!content.trim()) {
      content = $element.text();
    }
    
    return content.trim();
  }

  findLargestTextBlock($) {
    let largestText = '';
    let maxLength = 0;
    
    $('p, div, article, section').each((i, el) => {
      const text = $(el).text().trim();
      if (text.length > maxLength && text.length > 50) {
        maxLength = text.length;
        largestText = text;
      }
    });
    
    return largestText;
  }

  extractTitle($) {
    for (const selector of this.selectors.title) {
      const element = $(selector).first();
      if (element.length > 0) {
        const title = element.text().trim();
        if (title && title.length > 5) {
          return title;
        }
      }
    }
    
    // Fallback to page title
    const pageTitle = $('title').text().trim();
    return pageTitle || 'Untitled';
  }

  extractAuthor($) {
    for (const selector of this.selectors.author) {
      const element = $(selector).first();
      if (element.length > 0) {
        const author = element.text().trim();
        if (author && author.length > 2) {
          return this.cleanAuthorName(author);
        }
      }
    }
    
    // Try meta tags
    const metaAuthor = $('meta[name="author"]').attr('content');
    if (metaAuthor) {
      return this.cleanAuthorName(metaAuthor);
    }
    
    return null;
  }

  extractPublishDate($) {
    // Try structured selectors first
    for (const selector of this.selectors.date) {
      const element = $(selector).first();
      if (element.length > 0) {
        const dateText = element.attr('datetime') || element.text().trim();
        const date = this.parseDate(dateText);
        if (date) return date;
      }
    }
    
    // Try meta tags
    const metaSelectors = [
      'meta[property="article:published_time"]',
      'meta[name="publishdate"]',
      'meta[name="date"]',
      'meta[property="og:article:published_time"]'
    ];
    
    for (const selector of metaSelectors) {
      const content = $(selector).attr('content');
      if (content) {
        const date = this.parseDate(content);
        if (date) return date;
      }
    }
    
    return null;
  }

  extractImages($, baseUrl) {
    const images = [];
    const seenUrls = new Set();
    
    $('img').each((i, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      if (src) {
        const absoluteUrl = this.makeAbsoluteUrl(src, baseUrl);
        if (!seenUrls.has(absoluteUrl)) {
          seenUrls.add(absoluteUrl);
          images.push({
            url: absoluteUrl,
            alt: $(el).attr('alt') || '',
            width: $(el).attr('width') || null,
            height: $(el).attr('height') || null
          });
        }
      }
    });
    
    return images.slice(0, 10); // Limit to 10 images
  }

  extractLinks($, baseUrl) {
    const links = [];
    const seenUrls = new Set();
    
    $('a[href]').each((i, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      
      if (href && text) {
        const absoluteUrl = this.makeAbsoluteUrl(href, baseUrl);
        if (!seenUrls.has(absoluteUrl) && this.isValidLink(absoluteUrl)) {
          seenUrls.add(absoluteUrl);
          links.push({
            url: absoluteUrl,
            text: text.substring(0, 100), // Limit text length
            rel: $(el).attr('rel') || null
          });
        }
      }
    });
    
    return links.slice(0, 20); // Limit to 20 links
  }

  cleanText(text) {
    if (!text) return '';
    
    return text
      .replace(/\s+/g, ' ')           // Normalize whitespace
      .replace(/\n\s*\n/g, '\n\n')    // Normalize line breaks
      .replace(/^\s+|\s+$/g, '')      // Trim
      .replace(/&nbsp;/g, ' ')        // Replace HTML entities
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&hellip;/g, '...')
      .replace(/&mdash;/g, '—')
      .replace(/&ndash;/g, '–');
  }

  cleanAuthorName(author) {
    return author
      .replace(/^(by|author|written by):?\s*/i, '')
      .replace(/\s*(reporter|correspondent|editor)$/i, '')
      .trim();
  }

  parseDate(dateString) {
    if (!dateString) return null;
    
    // Try to parse the date
    const date = new Date(dateString);
    if (!isNaN(date.getTime())) {
      return date;
    }
    
    // Try common date patterns
    const patterns = [
      /(\d{4})-(\d{2})-(\d{2})/,           // YYYY-MM-DD
      /(\d{2})\/(\d{2})\/(\d{4})/,         // MM/DD/YYYY
      /(\d{2})-(\d{2})-(\d{4})/,           // MM-DD-YYYY
      /(\w+)\s+(\d{1,2}),?\s+(\d{4})/,     // Month DD, YYYY
    ];
    
    for (const pattern of patterns) {
      const match = dateString.match(pattern);
      if (match) {
        try {
          const parsedDate = new Date(dateString);
          if (!isNaN(parsedDate.getTime())) {
            return parsedDate;
          }
        } catch (e) {
          continue;
        }
      }
    }
    
    return null;
  }

  makeAbsoluteUrl(url, baseUrl) {
    try {
      // If URL is already absolute, return it
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
      }
      
      // If URL starts with //, add protocol
      if (url.startsWith('//')) {
        const protocol = new URL(baseUrl).protocol;
        return protocol + url;
      }
      
      // Create absolute URL
      return new URL(url, baseUrl).href;
    } catch (e) {
      return url;
    }
  }

  isValidLink(url) {
    try {
      const urlObj = new URL(url);
      // Only keep HTTP(S) links
      return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    } catch (e) {
      return false;
    }
  }

  countWords(text) {
    if (!text) return 0;
    return text.split(/\s+/).filter(word => word.length > 0).length;
  }

  estimateReadingTime(text, wordsPerMinute = 200) {
    const wordCount = this.countWords(text);
    const minutes = Math.ceil(wordCount / wordsPerMinute);
    return Math.max(1, minutes); // Minimum 1 minute
  }

  // Extract structured data from JSON-LD
  extractStructuredData($) {
    const structuredData = [];
    
    $('script[type="application/ld+json"]').each((i, el) => {
      try {
        const json = JSON.parse($(el).html());
        structuredData.push(json);
      } catch (e) {
        // Ignore invalid JSON-LD
      }
    });
    
    return structuredData;
  }

  // Extract meta tags for additional context
  extractMetaTags($) {
    const metaTags = {};
    
    // Open Graph tags
    $('meta[property^="og:"]').each((i, el) => {
      const property = $(el).attr('property');
      const content = $(el).attr('content');
      if (property && content) {
        metaTags[property] = content;
      }
    });
    
    // Twitter Card tags
    $('meta[name^="twitter:"]').each((i, el) => {
      const name = $(el).attr('name');
      const content = $(el).attr('content');
      if (name && content) {
        metaTags[name] = content;
      }
    });
    
    // Standard meta tags
    const standardTags = ['description', 'keywords', 'author'];
    standardTags.forEach(tag => {
      const content = $(`meta[name="${tag}"]`).attr('content');
      if (content) {
        metaTags[tag] = content;
      }
    });
    
    return metaTags;
  }

  // Enhanced extraction with all features
  async extractComplete(html, url) {
    try {
      const $ = cheerio.load(html);
      
      // Remove unwanted elements
      this.removeUnwantedElements($);
      
      // Extract all content
      const result = {
        content: this.cleanText(this.extractMainContent($)),
        title: this.cleanText(this.extractTitle($)),
        author: this.cleanText(this.extractAuthor($)),
        publishDate: this.extractPublishDate($),
        images: this.extractImages($, url),
        links: this.extractLinks($, url),
        metaTags: this.extractMetaTags($),
        structuredData: this.extractStructuredData($)
      };
      
      // Add computed metrics
      result.wordCount = this.countWords(result.content);
      result.readingTime = this.estimateReadingTime(result.content);
      result.hasImages = result.images.length > 0;
      result.hasLinks = result.links.length > 0;
      result.contentQuality = this.assessContentQuality(result);
      
      return result;
      
    } catch (error) {
      logger.error('Complete content extraction failed:', error);
      return null;
    }
  }

  assessContentQuality(extracted) {
    let score = 0;
    
    // Content length (0-30 points)
    const wordCount = extracted.wordCount;
    if (wordCount > 500) score += 30;
    else if (wordCount > 200) score += 20;
    else if (wordCount > 100) score += 10;
    
    // Has title (0-20 points)
    if (extracted.title && extracted.title.length > 10) score += 20;
    else if (extracted.title) score += 10;
    
    // Has author (0-15 points)
    if (extracted.author) score += 15;
    
    // Has publish date (0-15 points)
    if (extracted.publishDate) score += 15;
    
    // Has images (0-10 points)
    if (extracted.images.length > 0) score += 10;
    
    // Has structured data (0-10 points)
    if (extracted.structuredData.length > 0) score += 10;
    
    return Math.min(100, score);
  }
}

module.exports = ContentExtractor;