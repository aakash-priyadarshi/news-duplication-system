const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

// Get all articles with pagination
router.get('/articles', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    const dbManager = services.dbManager;
    
    if (!dbManager) {
      return res.status(503).json({ error: 'Database service not available' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;
    
    // Build query
    const query = {};
    
    if (req.query.source) {
      query.source = req.query.source;
    }
    
    if (req.query.category) {
      query.category = req.query.category;
    }
    
    if (req.query.isDuplicate !== undefined) {
      query.isDuplicate = req.query.isDuplicate === 'true';
    }
    
    // Date range
    if (req.query.from || req.query.to) {
      query.publishedAt = {};
      if (req.query.from) {
        query.publishedAt.$gte = new Date(req.query.from);
      }
      if (req.query.to) {
        query.publishedAt.$lte = new Date(req.query.to);
      }
    }

    const articles = await dbManager.findArticles(query, {
      sort: { publishedAt: -1 },
      skip,
      limit
    });

    // Get total count for pagination
    const total = await dbManager.mongodb.collection('articles').countDocuments(query);

    res.json({
      articles,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNext: skip + limit < total,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    logger.error('Failed to get articles:', error);
    res.status(500).json({ error: 'Failed to retrieve articles' });
  }
});

// Get specific article
router.get('/articles/:id', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    const dbManager = services.dbManager;
    
    if (!dbManager) {
      return res.status(503).json({ error: 'Database service not available' });
    }

    const { ObjectId } = require('mongodb');
    const article = await dbManager.findArticle({ _id: new ObjectId(req.params.id) });
    
    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    // Get duplicates if any
    const duplicates = await dbManager.findDuplicates({
      $or: [
        { originalArticleId: article._id },
        { duplicateArticleId: article._id }
      ]
    });

    res.json({
      article,
      duplicates: duplicates.length
    });

  } catch (error) {
    logger.error('Failed to get article:', error);
    res.status(500).json({ error: 'Failed to retrieve article' });
  }
});

// Get article duplicates
router.get('/articles/:id/duplicates', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    const dbManager = services.dbManager;
    
    if (!dbManager) {
      return res.status(503).json({ error: 'Database service not available' });
    }

    const { ObjectId } = require('mongodb');
    const articleId = new ObjectId(req.params.id);
    
    const duplicates = await dbManager.findDuplicates({
      $or: [
        { originalArticleId: articleId },
        { duplicateArticleId: articleId }
      ]
    });

    res.json({ duplicates });

  } catch (error) {
    logger.error('Failed to get article duplicates:', error);
    res.status(500).json({ error: 'Failed to retrieve duplicates' });
  }
});

// Get all duplicate relationships
router.get('/duplicates', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    const dbManager = services.dbManager;
    
    if (!dbManager) {
      return res.status(503).json({ error: 'Database service not available' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;
    
    const query = {};
    
    if (req.query.method) {
      query.detectionMethod = req.query.method;
    }
    
    if (req.query.minSimilarity) {
      query.similarityScore = { $gte: parseFloat(req.query.minSimilarity) };
    }

    const duplicates = await dbManager.findDuplicates(query, {
      sort: { createdAt: -1 },
      skip,
      limit
    });

    const total = await dbManager.mongodb.collection('duplicates').countDocuments(query);

    res.json({
      duplicates,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('Failed to get duplicates:', error);
    res.status(500).json({ error: 'Failed to retrieve duplicates' });
  }
});

// Get RSS feeds
router.get('/feeds', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    const dbManager = services.dbManager;
    
    if (!dbManager) {
      return res.status(503).json({ error: 'Database service not available' });
    }

    const feeds = await dbManager.mongodb.collection('feeds').find({}).toArray();

    res.json({ feeds });

  } catch (error) {
    logger.error('Failed to get feeds:', error);
    res.status(500).json({ error: 'Failed to retrieve feeds' });
  }
});

// Add new RSS feed
router.post('/feeds', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    const dbManager = services.dbManager;
    
    if (!dbManager) {
      return res.status(503).json({ error: 'Database service not available' });
    }

    const { id, name, url, category, priority, tags, enabled } = req.body;
    
    // Validate required fields
    if (!id || !name || !url) {
      return res.status(400).json({ 
        error: 'Missing required fields: id, name, url' 
      });
    }

    const feed = {
      id,
      name,
      url,
      category: category || 'other',
      priority: priority || 'medium',
      tags: tags || [],
      enabled: enabled !== false,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastFetchedAt: null,
      articlesProcessed: 0,
      errorCount: 0
    };

    await dbManager.mongodb.collection('feeds').insertOne(feed);

    res.status(201).json({ 
      message: 'Feed added successfully',
      feed
    });

  } catch (error) {
    logger.error('Failed to add feed:', error);
    res.status(500).json({ error: 'Failed to add feed' });
  }
});

// Update RSS feed
router.put('/feeds/:id', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    const dbManager = services.dbManager;
    
    if (!dbManager) {
      return res.status(503).json({ error: 'Database service not available' });
    }

    const feedId = req.params.id;
    const updates = req.body;
    
    delete updates._id; // Prevent ID updates
    updates.updatedAt = new Date();

    const result = await dbManager.mongodb.collection('feeds').updateOne(
      { id: feedId },
      { $set: updates }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Feed not found' });
    }

    res.json({ message: 'Feed updated successfully' });

  } catch (error) {
    logger.error('Failed to update feed:', error);
    res.status(500).json({ error: 'Failed to update feed' });
  }
});

// Delete RSS feed
router.delete('/feeds/:id', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    const dbManager = services.dbManager;
    
    if (!dbManager) {
      return res.status(503).json({ error: 'Database service not available' });
    }

    const feedId = req.params.id;

    const result = await dbManager.mongodb.collection('feeds').deleteOne({ id: feedId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Feed not found' });
    }

    res.json({ message: 'Feed deleted successfully' });

  } catch (error) {
    logger.error('Failed to delete feed:', error);
    res.status(500).json({ error: 'Failed to delete feed' });
  }
});

// Search articles
router.get('/search', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    const dbManager = services.dbManager;
    
    if (!dbManager) {
      return res.status(503).json({ error: 'Database service not available' });
    }

    const { q, page = 1, limit = 20 } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Search query required' });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Text search
    const query = {
      $text: { $search: q }
    };

    const articles = await dbManager.findArticles(query, {
      sort: { score: { $meta: 'textScore' }, publishedAt: -1 },
      skip,
      limit: parseInt(limit)
    });

    const total = await dbManager.mongodb.collection('articles').countDocuments(query);

    res.json({
      query: q,
      articles,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    logger.error('Search failed:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Get statistics
router.get('/stats', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    const dbManager = services.dbManager;
    
    if (!dbManager) {
      return res.status(503).json({ error: 'Database service not available' });
    }

    const stats = await dbManager.getStats();
    
    // Add processing stats
    if (services.newsProcessor) {
      stats.processing = services.newsProcessor.getStats();
    }
    
    if (services.deduplicationEngine) {
      stats.deduplication = services.deduplicationEngine.getStats();
    }

    res.json(stats);

  } catch (error) {
    logger.error('Failed to get stats:', error);
    res.status(500).json({ error: 'Failed to retrieve statistics' });
  }
});

module.exports = router;