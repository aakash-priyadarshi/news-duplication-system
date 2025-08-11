# News Deduplication System


[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green?logo=node.js)](https://nodejs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-7.0%2B-green?logo=mongodb)](https://mongodb.com/)
[![Redis](https://img.shields.io/badge/Redis-7.2%2B-red?logo=redis)](https://redis.io/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A comprehensive solution to eliminate redundant news alerts in automated sales intelligence workflows. This system tackles the challenge of multiple publications covering the same breaking news story at different times, which can create alert fatigue for sales teams. It detects duplicate news in real-time and delivers only unique, high-value alerts.

![Dashboard Screenshot](https://via.placeholder.com/800x400/667eea/white?text=News+Deduplication+Dashboard)

## 🎯 Key Features

### Real-time Duplicate Detection
- **Multi-source monitoring** across RSS news feeds with continuous monitoring
- **Multi-layered deduplication** using content fingerprinting, text similarity (TF-IDF & string matching), semantic embeddings, entity extraction, and optional LLM validation
- **Time-windowed clustering** to group breaking news variations and account for publication timing differences
- **Advanced similarity algorithms** with configurable thresholds and weights

### Scalable Architecture
- **High-performance storage** powered by MongoDB (primary store) and Redis (caching and rate-limiting)
- **Parallel processing** with configurable batch sizes and concurrent feed handling
- **Stateless design** enabling horizontal scaling for high throughput
- **Resource optimization** with intelligent caching and memory management

### Intelligent Alert System
- **Multi-channel alerts** with intelligent routing to webhook (n8n), email, and Slack based on priority and category
- **Rate limiting and cooldowns** to prevent alert fatigue while ensuring important news gets through
- **Priority-based routing** with customizable business rules
- **Quality filtering** based on content length, source credibility, and importance indicators

### Comprehensive Monitoring
- **Built-in dashboard** for live visualization of system status, recent articles, and deduplication metrics
- **RESTful API** with comprehensive endpoints for integration and monitoring
- **Prometheus-compatible metrics** for enterprise monitoring solutions
- **Detailed health checks** with service-level status reporting

### Workflow Integration
- **n8n workflow integration** via webhooks for automated alert processing and custom business logic
- **Extensible architecture** supporting custom alert channels and processing logic
- **API-first design** enabling easy integration with existing systems

## 🏗️ Architecture Overview

### Core Components

#### NewsProcessor
Handles RSS feed polling, parsing, and article extraction with the following capabilities:
- Monitors all configured feeds (default every 5 minutes) with parallel processing
- Extracts and cleans content, metadata (author, published date, etc.)
- Performs full-text content extraction when RSS provides only summaries
- Generates content hashes for exact duplicate detection
- Identifies named entities (people, organizations, locations, etc.)
- Stores articles in MongoDB and emits `articleProcessed` events

#### DeduplicationEngine  
Performs sophisticated multi-layered duplicate detection:

**Similarity Analysis Layers:**
1. **Content Fingerprinting** - SHA-256 hash comparison for exact duplicates
2. **Title Similarity** - Jaccard and cosine similarity on normalized titles
3. **Content Similarity** - TF-IDF vector similarity on article bodies
4. **Named Entity Overlap** - Common entities between articles analysis
5. **Semantic Vector Similarity** - Embedding-based comparison using configurable models
6. **Temporal Proximity** - Publication timing and source alignment analysis

**Advanced Features:**
- Configurable similarity thresholds and weights for each layer
- Optional LLM validation using GPT or Claude for borderline cases
- Clustering mechanism to group related articles and identify originals
- Time-windowed analysis (configurable hours) to focus on current news cycles
- Detailed similarity breakdowns stored for transparency and debugging

#### AlertManager
Orchestrates intelligent alert routing and delivery:

**Quality Filtering:**
- Rate limiting (max alerts per hour, cooldown periods)
- Content quality assessment (length, entities, source credibility)
- Breaking news detection (keywords like "acquisition", "IPO", etc.)
- Source priority weighting

**Multi-channel Delivery:**
- **Webhook** - Always used for n8n workflow integration
- **Email** - High-priority alerts via SMTP
- **Slack** - Category-specific alerts (business, technology)
- **Custom channels** - Extensible architecture for new delivery methods

**Alert Management:**
- Asynchronous processing to avoid blocking main flow
- Status tracking (pending → sent/failed) with retry logic
- Comprehensive delivery statistics and error handling
- Template customization for different channels

#### DatabaseManager
Abstraction layer providing:
- MongoDB operations for articles, duplicates, feeds, metrics
- Redis caching for embeddings, content hashes, and frequently accessed data
- Connection pooling and automatic reconnection handling
- Health monitoring and performance metrics
- Data aggregation for statistics and reporting

### Supporting Components

#### ContentExtractor & EntityExtractor
- **ContentExtractor**: Uses Cheerio-based heuristics to extract full text from HTML
- **EntityExtractor**: Identifies named entities using NLP and regex patterns
- **Language Detection**: Automatic language identification for content
- **Content Quality Assessment**: Evaluates article completeness and relevance

#### ClusteringEngine
- Maintains clusters of related articles using advanced algorithms
- Groups duplicates and near-duplicates into coherent story clusters
- Tracks story evolution over time with metadata preservation
- Enables consolidated alerting for story clusters

#### LLM Integration
- **OpenAI GPT**: Content analysis and similarity validation
- **Anthropic Claude**: Alternative LLM for content understanding
- **Cohere**: Multilingual embeddings for semantic similarity
- **Fallback mechanisms**: Graceful degradation when LLM services unavailable

## 🚀 Quick Start

### Prerequisites
- **Node.js 18+** and **npm 9+**
- **MongoDB 7.0+** (for storing articles, clusters, metrics)
- **Redis 7.2+** (for caching and rate limiting)
- **(Optional)** Docker & Docker Compose for easy dependency setup

### Installation

1. **Clone and set up the project:**
```bash
git clone https://github.com/aakash-priyadarshi/news-duplication-system.git
cd news-duplication-system
npm run setup
```

2. **Install dependencies:**
```bash
npm install
```

3. **Configure environment variables:**
```bash
cp .env.example .env
# Edit the .env file with your configuration
```

4. **Start dependencies using Docker:**
```bash
docker-compose up -d mongodb redis
```

5. **Run the application:**
```bash
npm run dev
```

6. **Access the dashboard:**
Visit [http://localhost:3000/dashboard](http://localhost:3000/dashboard) for real-time monitoring

## 🔧 Configuration

### Core Environment Variables

```env
# Server Settings
NODE_ENV=development
PORT=3000
HOST=localhost

# Database Connections
MONGODB_URI=mongodb://localhost:27017/news_deduplication
REDIS_URL=redis://localhost:6379

# AI Providers (at least one recommended for LLM features)
OPENAI_API_KEY=your_openai_api_key_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
COHERE_API_KEY=your_cohere_api_key_here

# n8n Integration
N8N_WEBHOOK_URL=http://localhost:5678/webhook/news-alerts
N8N_API_KEY=your_n8n_api_key_here
N8N_BASE_URL=http://localhost:5678

# Deduplication Settings
SIMILARITY_THRESHOLD=0.85          # Overall similarity threshold (0.0-1.0)
TIME_WINDOW_HOURS=24               # Look-back window for duplicates
CONTENT_FINGERPRINT_ALGO=sha256    # Content hashing algorithm
SEMANTIC_MODEL=sentence-transformers/all-MiniLM-L6-v2

# Performance Tuning
MAX_CONCURRENT_FEEDS=10            # Parallel RSS feed fetches
BATCH_SIZE=50                      # Deduplication batch size
VECTOR_DIMENSION=384               # Embedding vector dimension

# Alert Configuration
ALERT_COOLDOWN_MINUTES=5           # Min time between similar alerts
MAX_ALERTS_PER_HOUR=20            # Global alert rate limit
ENABLE_EMAIL_ALERTS=false         # Email channel toggle
ENABLE_SLACK_ALERTS=false         # Slack channel toggle
ENABLE_WEBHOOK_ALERTS=true        # Webhook/n8n channel toggle

# Security & Rate Limiting
JWT_SECRET=your_jwt_secret_here
API_RATE_LIMIT_WINDOW_MS=900000   # 15 minutes
API_RATE_LIMIT_MAX_REQUESTS=100   # Max requests per window per IP

# Monitoring
ENABLE_METRICS=true
METRICS_PORT=9090
HEALTH_CHECK_INTERVAL_MS=30000
LOG_LEVEL=info
```

### RSS Feeds Configuration

Configure feeds in `config/rss-feeds.json`:

```json
{
  "feeds": [
    {
      "id": "techcrunch",
      "name": "TechCrunch",
      "url": "https://techcrunch.com/feed/",
      "category": "technology",
      "priority": "high",
      "enabled": true,
      "tags": ["startups", "technology", "venture-capital"]
    },
    {
      "id": "reuters-business",
      "name": "Reuters Business", 
      "url": "https://feeds.reuters.com/reuters/businessNews",
      "category": "business",
      "priority": "high",
      "enabled": true,
      "tags": ["business", "finance", "markets"]
    }
  ],
  "settings": {
    "refreshIntervalMinutes": 5,
    "timeoutSeconds": 30,
    "retryAttempts": 3,
    "retryDelayMs": 1000
  }
}
```

### Similarity Detection Configuration

The system uses multiple algorithms with configurable thresholds:

| Method | Default Threshold | Description |
|--------|------------------|-------------|
| Content Hash | 1.0 | Exact duplicate detection |
| Title Similarity | 0.9 | Fuzzy title matching |
| Content Similarity | 0.85 | TF-IDF based analysis |
| Semantic Similarity | 0.85 | Vector embeddings |
| Entity Similarity | 0.8 | Named entity overlap |

## 📊 API Reference

### Health and Monitoring

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Basic system info and status |
| `/api/health` | GET | Simple health check |
| `/api/health/detailed` | GET | Detailed service health report |
| `/api/health/ready` | GET | Kubernetes readiness probe |
| `/api/health/live` | GET | Kubernetes liveness probe |
| `/api/metrics` | GET | System metrics overview (JSON) |
| `/api/metrics/prometheus` | GET | Prometheus-format metrics |
| `/api/metrics/processing` | GET | Feed processing metrics over time |
| `/api/metrics/duplicates` | GET | Duplicate detection statistics |
| `/api/metrics/alerts` | GET | Alert delivery metrics |
| `/api/metrics/sources` | GET | Source performance statistics |

### News and Articles

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/news/articles` | GET | List articles with pagination and filters |
| `/api/news/articles/:id` | GET | Get specific article details |
| `/api/news/articles/:id/duplicates` | GET | Get duplicates for specific article |
| `/api/news/duplicates` | GET | List all duplicate relationships |
| `/api/news/search` | GET | Full-text search across articles |
| `/api/news/stats` | GET | High-level processing statistics |
| `/api/news/feeds` | GET | List configured RSS feeds |
| `/api/news/feeds` | POST | Add new RSS feed |
| `/api/news/feeds/:id` | PUT | Update existing feed |
| `/api/news/feeds/:id` | DELETE | Remove RSS feed |

### Alerts

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/alerts` | GET | List recent alerts with pagination |
| `/api/alerts/status/:status` | GET | Filter alerts by status |
| `/api/alerts/:id` | GET | Get specific alert details |
| `/api/alerts/stats` | GET | Alert delivery statistics |
| `/api/alerts/test` | POST | Send test alert through all channels |
| `/api/alerts/manual` | POST | Create custom manual alert |
| `/api/alerts/:id/status` | PATCH | Update alert status |
| `/api/alerts/:id` | DELETE | Delete alert record |
| `/api/alerts/:id/delivery` | GET | Get alert delivery details |
| `/api/alerts/bulk/delete` | POST | Bulk delete alerts |
| `/api/alerts/export/csv` | GET | Export alerts as CSV |

### API Usage Examples

#### List Recent Articles
```bash
curl "http://localhost:3000/api/news/articles?limit=10&page=1&source=TechCrunch"
```

#### Search Articles
```bash
curl "http://localhost:3000/api/news/search?q=artificial%20intelligence&limit=5"
```

#### Add RSS Feed
```bash
curl -X POST "http://localhost:3000/api/news/feeds" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "venturebeat",
    "name": "VentureBeat",
    "url": "https://venturebeat.com/feed/",
    "category": "technology",
    "priority": "medium",
    "enabled": true,
    "tags": ["startups", "ai", "technology"]
  }'
```

#### Create Manual Alert
```bash
curl -X POST "http://localhost:3000/api/alerts/manual" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Important Market Update",
    "summary": "Significant development in the market",
    "priority": "high",
    "channels": ["webhook", "slack"]
  }'
```

## 🔄 n8n Workflow Integration

### Webhook Integration

The system integrates seamlessly with n8n through webhooks:

1. **Automatic Alerts**: Each unique article triggers a webhook POST to `N8N_WEBHOOK_URL`
2. **Custom Workflows**: Build sophisticated alert routing and processing in n8n
3. **Business Logic**: Apply custom filters, enrichments, and actions

### Sample n8n Workflow

```json
{
  "nodes": [
    {
      "name": "News Alert Webhook",
      "type": "n8n-nodes-base.webhook",
      "parameters": {
        "path": "news-alerts",
        "method": "POST",
        "responseMode": "onReceived"
      }
    },
    {
      "name": "Priority Filter",
      "type": "n8n-nodes-base.if",
      "parameters": {
        "conditions": {
          "string": [
            {
              "value1": "={{ $json[\"priority\"] }}",
              "operation": "equal",
              "value2": "high"
            }
          ]
        }
      }
    },
    {
      "name": "Send to Slack",
      "type": "n8n-nodes-base.slack",
      "parameters": {
        "channel": "#sales-intelligence",
        "text": "🚨 High Priority Alert: {{ $json[\"title\"] }}"
      }
    },
    {
      "name": "Log to Sheet",
      "type": "n8n-nodes-base.googleSheets",
      "parameters": {
        "operation": "append",
        "sheetId": "your-sheet-id",
        "range": "A:E"
      }
    }
  ]
}
```

### Alert Payload Structure

```json
{
  "type": "news_alert",
  "alert": {
    "id": "alert_1234567890_abc123",
    "title": "Major Acquisition Announced",
    "summary": "Company X acquires Company Y for $2B...",
    "source": "TechCrunch",
    "category": "business",
    "priority": "high",
    "url": "https://techcrunch.com/article-url",
    "publishedAt": "2024-01-15T10:30:00.000Z",
    "entities": [
      {"name": "Company X", "type": "ORGANIZATION"},
      {"name": "Company Y", "type": "ORGANIZATION"}
    ],
    "tags": ["acquisition", "technology", "business"],
    "createdAt": "2024-01-15T10:35:00.000Z"
  },
  "metadata": {
    "system": "news-deduplication",
    "version": "1.0.0",
    "timestamp": "2024-01-15T10:35:00.000Z"
  }
}
```

## 🎛️ Dashboard Features

### Real-time Overview
- **System Status**: Health indicators for all services
- **Processing Statistics**: Articles processed, duplicates detected, feed status
- **Performance Metrics**: Memory usage, uptime, processing times

### Interactive Visualizations
- **Source Distribution**: Pie chart showing article sources
- **Processing Trends**: Line chart of articles processed over time
- **Custom Time Ranges**: Configurable date ranges for analysis

### Article Management
- **Recent Articles**: Live feed of processed articles
- **Duplicate Status**: Visual indicators for duplicate detection
- **Search and Filter**: Find specific articles by content or metadata
- **Manual Actions**: Refresh data, export reports

### Feed Monitoring
- **Feed Health**: Status indicators for each RSS source
- **Error Tracking**: Detailed error logs and retry information
- **Performance Stats**: Processing times and success rates per feed

## 🧪 Testing

### Test Suites

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests
npm run test:integration

# Watch mode for development
npm run test:watch

# Coverage report
npm run test:coverage

# Linting
npm run lint

# Format code
npm run format
```

### Test Categories

- **Unit Tests**: Individual component testing (utilities, similarity algorithms)
- **Integration Tests**: End-to-end workflow testing (feed processing → deduplication → alerts)
- **API Tests**: REST endpoint validation and error handling
- **Performance Tests**: Load testing for high-volume scenarios

### Manual Testing

```bash
# Test API connectivity
curl http://localhost:3000/api/health

# Test feed processing
curl -X POST http://localhost:3000/api/alerts/test

# Monitor processing logs
tail -f logs/app.log

# Check database state
mongosh news_deduplication --eval "db.articles.countDocuments()"
```

## 📈 Performance & Monitoring

### Performance Optimization

#### Memory Management
- **Embedding Cache**: LRU cache for computed vectors (configurable size)
- **Content Hashing**: Redis cache for processed content fingerprints
- **Batch Processing**: Configurable batch sizes to manage memory usage
- **Connection Pooling**: Efficient database connection management

#### Processing Optimization
- **Parallel Feed Processing**: Concurrent RSS feed fetching
- **Similarity Algorithm Optimization**: Early termination for obvious non-matches
- **Index Optimization**: Strategic MongoDB indexes for query performance
- **Time-windowed Processing**: Limits comparison scope for recent articles

#### Configuration Tuning

| Parameter | Default | Description | Tuning Guidance |
|-----------|---------|-------------|-----------------|
| `SIMILARITY_THRESHOLD` | 0.85 | Duplicate detection sensitivity | Lower = more duplicates detected, higher = fewer false positives |
| `TIME_WINDOW_HOURS` | 24 | Comparison window | Adjust based on news cycle speed |
| `MAX_CONCURRENT_FEEDS` | 10 | Parallel feed processing | Increase for better performance, decrease if overwhelming sources |
| `BATCH_SIZE` | 50 | Articles per processing batch | Adjust based on available memory |
| `VECTOR_DIMENSION` | 384 | Embedding vector size | Must match your semantic model |

### Monitoring and Metrics

#### System Metrics
- **Resource Usage**: Memory, CPU, disk space
- **Database Performance**: Query times, connection pool status
- **Cache Hit Rates**: Redis and in-memory cache effectiveness
- **Processing Throughput**: Articles per minute, queue sizes

#### Business Metrics
- **Duplicate Detection Accuracy**: True/false positive rates
- **Alert Delivery Success**: Channel-specific success rates
- **Feed Reliability**: Uptime and error rates per source
- **Response Times**: End-to-end processing latency

#### Prometheus Integration

Access Prometheus metrics at `/api/metrics/prometheus`:

```
# HELP news_dedup_articles_processed_total Total articles processed
# TYPE news_dedup_articles_processed_total counter
news_dedup_articles_processed_total 1234

# HELP news_dedup_duplicates_detected_total Total duplicates detected
# TYPE news_dedup_duplicates_detected_total counter
news_dedup_duplicates_detected_total 89

# HELP news_dedup_memory_heap_used_bytes Memory heap used in bytes
# TYPE news_dedup_memory_heap_used_bytes gauge
news_dedup_memory_heap_used_bytes 157286400
```

## 🐳 Deployment

### Docker Deployment

#### Development Setup
```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f app

# Scale application instances
docker-compose up -d --scale app=3

# Stop services
docker-compose down
```

#### Production Considerations

```yaml
# docker-compose.prod.yml
version: '3.8'
services:
  app:
    build: .
    environment:
      - NODE_ENV=production
      - LOG_LEVEL=warn
    deploy:
      replicas: 3
      resources:
        limits:
          memory: 1G
          cpus: '0.5'
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

### Environment-Specific Configuration

#### Production Environment
- Set `NODE_ENV=production`
- Use strong secrets for `JWT_SECRET`
- Configure HTTPS reverse proxy
- Set up log aggregation
- Enable monitoring and alerting
- Use managed databases (MongoDB Atlas, Redis Cloud)

#### Staging Environment
- Mirror production configuration
- Use test API keys for LLM services
- Enable debug logging for testing
- Isolated database instances

#### Development Environment
- Use local databases via Docker
- Enable detailed logging (`LOG_LEVEL=debug`)
- Hot reload with `nodemon`
- Mock external services when needed

### Scaling Strategies

#### Horizontal Scaling
- **Stateless Design**: Multiple app instances can run simultaneously
- **Database Coordination**: MongoDB handles concurrent access
- **Load Balancing**: Use nginx or cloud load balancers
- **Session Storage**: Redis for shared session state

#### Vertical Scaling
- **Memory Optimization**: Increase heap size for large deployments
- **CPU Utilization**: Adjust batch sizes and concurrent processing
- **Database Resources**: Scale MongoDB and Redis based on usage

#### Microservice Architecture
- **Feed Processing Service**: Dedicated RSS monitoring
- **Deduplication Service**: Isolated similarity analysis
- **Alert Service**: Separate notification handling
- **API Gateway**: Centralized request routing

## 🔐 Security

### Security Features

#### Input Validation
- **Environment Variable Validation**: Joi schema validation on startup
- **API Input Sanitization**: Request payload validation and sanitization
- **Content Sanitization**: HTML tag filtering and XSS prevention
- **Rate Limiting**: Global and endpoint-specific rate limits

#### Authentication & Authorization
- **JWT Token Support**: Built-in JWT secret configuration
- **API Rate Limiting**: Prevents abuse and DOS attacks
- **Secure Headers**: Helmet.js security headers
- **CORS Configuration**: Configurable cross-origin policies

#### Data Protection
- **Sensitive Data Handling**: No API keys or secrets in logs
- **Database Security**: Connection string encryption support
- **Redis Security**: Optional authentication and encryption
- **Content Security Policy**: XSS protection for dashboard

### Production Security Checklist

- [ ] Generate strong `JWT_SECRET` (32+ characters)
- [ ] Enable HTTPS with valid certificates
- [ ] Configure firewall rules (only expose necessary ports)
- [ ] Set up MongoDB authentication and authorization
- [ ] Enable Redis authentication if exposed
- [ ] Regular security updates for dependencies
- [ ] Monitor for suspicious API usage patterns
- [ ] Implement backup and disaster recovery
- [ ] Set up intrusion detection
- [ ] Regular security audits and penetration testing

## 🛠️ Development

### Project Structure

```
src/
├── config/          # Configuration files and environment setup
│   ├── config.js    # Main configuration loader with validation
│   └── logging.js   # Logging configuration
├── routes/          # Express route definitions
│   ├── news.js      # News and article endpoints
│   ├── alerts.js    # Alert management endpoints
│   ├── health.js    # Health check endpoints
│   └── metrics.js   # Monitoring and metrics endpoints
├── services/        # Core business logic services
│   ├── NewsProcessor.js        # RSS feed processing
│   ├── DeduplicationEngine.js  # Duplicate detection
│   ├── AlertManager.js         # Alert orchestration
│   └── DatabaseManager.js      # Database abstraction
├── utils/           # Utility classes and helpers
│   ├── LLMAnalyzer.js          # AI/LLM integration
│   ├── VectorSimilarity.js     # Embedding operations
│   ├── ContentExtractor.js     # Content parsing
│   ├── EntityExtractor.js      # Named entity recognition
│   ├── ClusteringEngine.js     # Article clustering
│   ├── healthcheck.js          # Health monitoring
│   └── logger.js               # Logging utilities
├── middleware/      # Express middleware
└── index.js         # Application entry point
```

### Development Workflow

#### Adding New Features

1. **New Similarity Algorithm**:
   ```javascript
   // In DeduplicationEngine.js
   async calculateCustomSimilarity(article1, article2) {
     // Implement your algorithm
     return similarityScore;
   }
   
   // Add to calculateSimilarityScore method
   scores.customSimilarity = await this.calculateCustomSimilarity(article1, article2);
   ```

2. **New Alert Channel**:
   ```javascript
   // In AlertManager.js
   async sendCustomAlert(alert) {
     // Implement channel-specific logic
     return { success: true, message: 'Sent successfully' };
   }
   
   // Add to sendAlert method channel handling
   case 'custom':
     result = await this.sendCustomAlert(alert);
     break;
   ```

3. **New RSS Source Type**:
   ```javascript
   // In NewsProcessor.js
   async processCustomSource(source) {
     // Implement custom parsing logic
     return articles;
   }
   ```

#### Code Quality Standards

- **ESLint Configuration**: Enforced code style and error detection
- **Prettier Formatting**: Consistent code formatting
- **JSDoc Comments**: Comprehensive documentation for public methods
- **Error Handling**: Graceful error handling with proper logging
- **Testing Coverage**: Minimum 80% test coverage for new features

#### Development Commands

```bash
# Start development server with hot reload
npm run dev

# Run tests in watch mode
npm run test:watch

# Lint and fix code issues
npm run lint:fix

# Format code with Prettier
npm run format

# Generate documentation
npm run docs

# Build for production
npm run build

# Performance profiling
npm run profile
```

### Debugging

#### Debug Mode
```bash
# Enable debug logging
LOG_LEVEL=debug npm run dev

# Enable Node.js inspector
node --inspect src/index.js

# Memory usage profiling
node --max-old-space-size=4096 src/index.js
```

#### Common Debug Scenarios

1. **Feed Processing Issues**:
   ```bash
   # Check feed status
   curl http://localhost:3000/api/news/feeds
   
   # View processing logs
   tail -f logs/app.log | grep "Processing feed"
   ```

2. **Duplicate Detection Problems**:
   ```bash
   # Check similarity scores
   curl "http://localhost:3000/api/news/duplicates?limit=10"
   
   # Monitor deduplication engine
   curl http://localhost:3000/api/metrics
   ```

3. **Alert Delivery Failures**:
   ```bash
   # Check alert status
   curl http://localhost:3000/api/alerts/stats
   
   # Test alert channels
   curl -X POST http://localhost:3000/api/alerts/test
   ```

## 🤝 Contributing

We welcome contributions to improve the News Deduplication System! Here's how to get started:

### Contribution Guidelines

1. **Fork the Repository**
   ```bash
   git clone https://github.com/aakash-priyadarshi/news-duplication-system.git
   cd news-duplication-system
   ```

2. **Create Feature Branch**
   ```bash
   git checkout -b feature/amazing-new-feature
   ```

3. **Make Changes**
   - Follow existing code style and conventions
   - Add tests for new functionality
   - Update documentation as needed

4. **Test Your Changes**
   ```bash
   npm test
   npm run lint
   npm run format
   ```

5. **Submit Pull Request**
   - Provide clear description of changes
   - Include test results and screenshots if applicable
   - Link to any related issues

### Development Setup

```bash
# Install dependencies
npm install

# Set up development environment
cp .env.example .env
# Edit .env with your configuration

# Start development services
docker-compose up -d mongodb redis

# Run in development mode
npm run dev
```

### Areas for Contribution

- **Algorithm Improvements**: Better similarity detection methods
- **Performance Optimization**: Memory usage and processing speed
- **New Alert Channels**: Additional notification integrations
- **UI Enhancements**: Dashboard improvements and new features
- **Documentation**: Tutorials, examples, and API documentation
- **Testing**: Additional test coverage and edge cases
- **Monitoring**: New metrics and observability features

### Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help others learn and grow
- Follow the project's coding standards

## 🐛 Troubleshooting

### Common Issues and Solutions

#### Content Similarity Calculation Fails
**Symptoms**: Logs show "Content similarity calculation failed" warnings
**Causes**: 
- Empty or null content fields
- TF-IDF processing errors
- Memory limitations with large texts

**Solutions**:
```bash
# Check article content quality
curl "http://localhost:3000/api/news/articles?limit=5" | jq '.articles[].content'

# Adjust batch size to reduce memory usage
export BATCH_SIZE=25

# Enable debug logging to see detailed errors
export LOG_LEVEL=debug
```

#### Dashboard Shows No Data
**Symptoms**: Empty dashboard or loading indicators
**Causes**:
- API connectivity issues
- Database connection problems
- Missing public folder

**Solutions**:
```bash
# Test API connectivity
curl http://localhost:3000/api/health

# Check if public folder exists
ls -la public/

# Verify database connection
curl http://localhost:3000/api/health/detailed

# Check browser console for JavaScript errors
# Open browser dev tools → Console tab
```

#### RSS Feeds Not Processing
**Symptoms**: No new articles appearing, feed errors in logs
**Causes**:
- Network connectivity issues
- Invalid RSS feed URLs
- Rate limiting by feed sources

**Solutions**:
```bash
# Check feed configuration
cat config/rss-feeds.json

# Test feed URLs manually
curl -I "https://techcrunch.com/feed/"

# Check feed status in database
curl http://localhost:3000/api/news/feeds

# Review feed processing logs
tail -f logs/app.log | grep "Processing feed"

# Manually trigger feed processing
curl -X POST http://localhost:3000/api/news/feeds/refresh
```

#### High Memory Usage
**Symptoms**: Application crashes with out-of-memory errors
**Causes**:
- Large embedding cache
- Too many concurrent processes
- Memory leaks in similarity calculations

**Solutions**:
```bash
# Monitor memory usage
curl http://localhost:3000/api/metrics | jq '.system.memory'

# Reduce batch size and concurrent feeds
export BATCH_SIZE=25
export MAX_CONCURRENT_FEEDS=5

# Clear vector similarity cache
curl -X POST http://localhost:3000/api/utils/clear-cache

# Increase Node.js memory limit
node --max-old-space-size=4096 src/index.js
```

#### Database Connection Issues
**Symptoms**: "Database service not available" errors
**Causes**:
- MongoDB not running
- Connection string issues
- Network connectivity problems

**Solutions**:
```bash
# Check MongoDB status
docker-compose ps mongodb

# Test MongoDB connection
mongosh $MONGODB_URI --eval "db.runCommand('ping')"

# Restart MongoDB
docker-compose restart mongodb

# Check connection string format
echo $MONGODB_URI
```

#### Alert Delivery Failures
**Symptoms**: Alerts not reaching destinations, failed status in logs
**Causes**:
- Invalid webhook URLs
- Network connectivity issues
- Authentication problems

**Solutions**:
```bash
# Test webhook endpoint
curl -X POST $N8N_WEBHOOK_URL \
  -H "Content-Type: application/json" \
  -d '{"test": "message"}'

# Check alert delivery status
curl http://localhost:3000/api/alerts/stats

# Verify channel configuration
curl http://localhost:3000/api/alerts/:id/delivery

# Send test alert
curl -X POST http://localhost:3000/api/alerts/test
```

### Performance Issues

#### Slow Duplicate Detection
**Symptoms**: Long processing times, growing queue sizes
**Solutions**:
- Reduce `TIME_WINDOW_HOURS` to limit comparison scope
- Increase `SIMILARITY_THRESHOLD` to be more selective
- Scale up system resources or add more instances
- Optimize MongoDB indexes

#### High CPU Usage
**Symptoms**: System slowdown, high CPU utilization
**Solutions**:
- Reduce `MAX_CONCURRENT_FEEDS` to limit parallel processing
- Decrease `BATCH_SIZE` to reduce computational load
- Implement processing time limits
- Use more efficient similarity algorithms

### Debug Commands

```bash
# System health overview
curl http://localhost:3000/api/health/detailed | jq '.'

# Processing queue status
curl http://localhost:3000/api/metrics | jq '.services.deduplication.queueSize'

# Database statistics
curl http://localhost:3000/api/metrics | jq '.services.database'

# Recent errors in logs
tail -n 100 logs/app.log | grep -i error

# Memory usage monitoring
watch -n 5 'curl -s http://localhost:3000/api/metrics | jq .system.memory'
```

## 🔮 Future Enhancements

### Short-term Improvements

#### Enhanced Machine Learning
- **Fine-tuned Models**: Train domain-specific similarity models on news data
- **Active Learning**: Improve accuracy by learning from user feedback on duplicates
- **Multi-language Support**: Better handling of international news sources
- **Contextual Understanding**: Leverage transformer models for deeper content analysis

#### User Interface Enhancements
- **Real-time Updates**: WebSocket integration for live dashboard updates
- **Advanced Filtering**: More sophisticated search and filter options
- **User Management**: Authentication and role-based access control
- **Custom Dashboards**: User-configurable views and metrics

#### Performance Optimizations
- **Distributed Processing**: Scale across multiple servers with message queues
- **Caching Improvements**: More intelligent caching strategies
- **Database Optimization**: Advanced indexing and query optimization
- **Stream Processing**: Real-time processing with Apache Kafka or similar

### Long-term Vision

#### Advanced Analytics
- **Story Tracking**: Follow story evolution across time and sources
- **Trend Analysis**: Identify emerging topics and patterns
- **Sentiment Analysis**: Track sentiment changes across duplicate stories
- **Impact Assessment**: Measure story reach and influence

#### Enterprise Features
- **Multi-tenant Architecture**: Support multiple organizations
- **Advanced Security**: Enterprise-grade authentication and authorization
- **Compliance Tools**: Data retention and privacy controls
- **Audit Trails**: Comprehensive logging and reporting

#### AI Integration
- **Automated Categorization**: Smart content classification
- **Predictive Analytics**: Forecast trending topics
- **Natural Language Queries**: AI-powered search interface
- **Smart Summarization**: Intelligent content summarization

#### Integration Ecosystem
- **CRM Integration**: Direct integration with Salesforce, HubSpot
- **BI Tools**: Native connectors for Tableau, Power BI
- **Chat Platforms**: Microsoft Teams, Discord integration
- **Knowledge Management**: Integration with Confluence, Notion

### Research Areas

- **Graph-based Clustering**: Network analysis for story relationships
- **Temporal Pattern Recognition**: Time-series analysis for news cycles
- **Cross-modal Similarity**: Image and video content analysis
- **Federated Learning**: Privacy-preserving model training

## 📊 Performance Benchmarks

### System Requirements

| Deployment Size | Articles/Day | Memory | CPU | Storage |
|----------------|--------------|--------|-----|---------|
| Small | <1,000 | 2GB | 2 cores | 10GB |
| Medium | 1,000-10,000 | 4GB | 4 cores | 50GB |
| Large | 10,000-100,000 | 8GB | 8 cores | 200GB |
| Enterprise | >100,000 | 16GB+ | 16+ cores | 1TB+ |

### Performance Metrics

| Metric | Target | Typical |
|--------|--------|---------|
| Feed Processing Time | <30s per feed | 15s |
| Duplicate Detection | <5s per article | 2s |
| Alert Delivery | <10s | 3s |
| API Response Time | <200ms | 100ms |
| Accuracy Rate | >95% | 97% |
| False Positive Rate | <5% | 3% |

## 🌐 Community and Support

### Resources

- **GitHub Repository**: [https://github.com/aakash-priyadarshi/news-duplication-system](https://github.com/aakash-priyadarshi/news-duplication-system)
- **Documentation**: Comprehensive guides in `/docs` folder
- **API Reference**: Interactive API documentation at `/api/docs`
- **Examples**: Sample configurations and workflows in `/examples`

### Getting Help

1. **Check Documentation**: Review this README and `/docs` folder
2. **Search Issues**: Look for similar problems in GitHub Issues
3. **Create Issue**: Open new issue with detailed problem description
4. **Community Discussions**: Use GitHub Discussions for questions and ideas

### Contributing to Community

- **Share Configurations**: Submit useful RSS feed configurations
- **Write Tutorials**: Create guides for specific use cases
- **Report Bugs**: Help improve system reliability
- **Suggest Features**: Propose new functionality and improvements

## 📋 Changelog

### Version 1.0.0 (Current)
- Initial release with core deduplication functionality
- Multi-layered similarity detection algorithms
- Real-time dashboard with monitoring capabilities
- n8n webhook integration for workflow automation
- Comprehensive API with health checks and metrics
- Docker deployment support
- Extensive documentation and examples

### Planned Releases

#### Version 1.1.0
- Enhanced dashboard with real-time updates
- Improved similarity algorithms with ML models
- Advanced filtering and search capabilities
- Performance optimizations and caching improvements

#### Version 1.2.0
- Multi-language support for international news
- Advanced clustering algorithms
- User authentication and role management
- Enhanced monitoring and alerting

#### Version 2.0.0
- Microservice architecture
- Distributed processing capabilities
- Enterprise security features
- Advanced analytics and reporting

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

```
MIT License

Copyright (c) 2024 Aakash Priyadarshi

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 🙏 Acknowledgments

This project was built with the support of various open-source technologies and services:

### Core Technologies
- **Node.js & Express**: Server runtime and web framework
- **MongoDB**: Primary database for article storage and analytics
- **Redis**: High-performance caching and rate limiting
- **Docker**: Containerization and deployment orchestration

### AI and Machine Learning
- **OpenAI**: GPT models for content analysis and validation
- **Anthropic**: Claude for advanced language understanding
- **Cohere**: Multilingual embeddings for semantic similarity
- **Natural Language Processing**: Libraries for entity extraction and text analysis

### Frontend and Visualization
- **Chart.js**: Interactive charts and data visualization
- **Vanilla JavaScript**: Lightweight frontend without heavy frameworks
- **CSS Grid & Flexbox**: Modern responsive design patterns

### Development and Testing
- **Jest**: Comprehensive testing framework
- **ESLint & Prettier**: Code quality and formatting tools
- **Nodemon**: Development server with hot reload
- **Winston**: Structured logging and monitoring

### Integration and Automation
- **n8n**: Workflow automation and integration platform
- **Prometheus**: Metrics collection and monitoring
- **Webhook Technologies**: Real-time alert delivery

### Documentation and Community
- **Markdown**: Documentation format
- **GitHub**: Version control and collaboration
- **Open Source Community**: Inspiration and best practices

### Special Thanks
- **News Sources**: RSS feeds from TechCrunch, Reuters, Bloomberg, and VentureBeat
- **Open Source Contributors**: Developers who created the libraries this project depends on
- **AI Research Community**: Researchers advancing natural language processing and similarity detection
- **Sales Intelligence Teams**: Real-world feedback on information overload challenges

---

**Built with ❤️ to eliminate information overload in sales intelligence workflows.**

*For questions, suggestions, or contributions, please visit our [GitHub repository](https://github.com/aakash-priyadarshi/news-duplication-system) or open an issue.*