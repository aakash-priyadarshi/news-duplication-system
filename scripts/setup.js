#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

class ProjectSetup {
  constructor() {
    this.projectRoot = path.join(__dirname, '..');
    this.directories = [
      'src',
      'src/config',
      'src/controllers',
      'src/services',
      'src/models',
      'src/utils',
      'src/middleware',
      'src/routes',
      'src/processors',
      'src/workers',
      'config',
      'logs',
      'data',
      'tests',
      'tests/unit',
      'tests/integration',
      'docker',
      'scripts',
      'docs'
    ];
  }

  async createDirectories() {
    console.log('📁 Creating project directory structure...');
    
    for (const dir of this.directories) {
      const fullPath = path.join(this.projectRoot, dir);
      try {
        await fs.mkdir(fullPath, { recursive: true });
        console.log(`  ✅ Created: ${dir}`);
      } catch (error) {
        console.log(`  ⚠️  Directory already exists: ${dir}`);
      }
    }
  }

  async createEnvFile() {
    const envPath = path.join(this.projectRoot, '.env');
    const envExamplePath = path.join(this.projectRoot, '.env.example');
    
    try {
      await fs.access(envPath);
      console.log('⚠️  .env file already exists, skipping...');
    } catch {
      console.log('📝 Creating .env file from template...');
      try {
        const envExample = await fs.readFile(envExamplePath, 'utf8');
        await fs.writeFile(envPath, envExample);
        console.log('  ✅ Created .env file');
      } catch (error) {
        console.log('  ❌ Failed to create .env file:', error.message);
      }
    }
  }

  async createGitignore() {
    const gitignorePath = path.join(this.projectRoot, '.gitignore');
    const gitignoreContent = `
# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Logs
logs/
*.log

# Runtime data
pids/
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage/

# NYC test coverage
.nyc_output

# Dependency directories
jspm_packages/

# Optional npm cache directory
.npm

# Optional REPL history
.node_repl_history

# Output of 'npm pack'
*.tgz

# Yarn Integrity file
.yarn-integrity

# Database
data/*.db
data/*.sqlite

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# OS generated files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# Application specific
temp/
cache/
uploads/
exports/
`.trim();

    try {
      await fs.writeFile(gitignorePath, gitignoreContent);
      console.log('📝 Created .gitignore file');
    } catch (error) {
      console.log('❌ Failed to create .gitignore:', error.message);
    }
  }

  async createDockerFiles() {
    console.log('🐳 Creating Docker configuration...');
    
    const dockerfilePath = path.join(this.projectRoot, 'Dockerfile');
    const dockerfileContent = `
FROM node:18-alpine

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Change ownership
RUN chown -R nodejs:nodejs /app
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD node src/utils/healthcheck.js

CMD ["npm", "start"]
`.trim();

    const dockerComposePath = path.join(this.projectRoot, 'docker-compose.yml');
    const dockerComposeContent = `
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    depends_on:
      - mongodb
      - redis
    networks:
      - news-network
    volumes:
      - ./logs:/app/logs
      - ./config:/app/config

  mongodb:
    image: mongo:7.0
    ports:
      - "27017:27017"
    volumes:
      - mongodb_data:/data/db
      - ./docker/mongo-init.js:/docker-entrypoint-initdb.d/mongo-init.js:ro
    networks:
      - news-network

  redis:
    image: redis:7.2-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    networks:
      - news-network

  n8n:
    image: n8nio/n8n:latest
    ports:
      - "5678:5678"
    environment:
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=admin
      - N8N_BASIC_AUTH_PASSWORD=admin
    volumes:
      - n8n_data:/home/node/.n8n
    networks:
      - news-network

volumes:
  mongodb_data:
  redis_data:
  n8n_data:

networks:
  news-network:
    driver: bridge
`.trim();

    try {
      await fs.writeFile(dockerfilePath, dockerfileContent);
      await fs.writeFile(dockerComposePath, dockerComposeContent);
      console.log('  ✅ Created Docker configuration files');
    } catch (error) {
      console.log('  ❌ Failed to create Docker files:', error.message);
    }
  }

  async createConfigFiles() {
    console.log('⚙️  Creating configuration files...');
    
    const rssConfigPath = path.join(this.projectRoot, 'config', 'rss-feeds.json');
    const rssConfig = {
      feeds: [
        {
          id: "techcrunch",
          name: "TechCrunch",
          url: "https://techcrunch.com/feed/",
          category: "technology",
          priority: "high",
          enabled: true,
          tags: ["startups", "technology", "venture-capital"]
        },
        {
          id: "reuters-business",
          name: "Reuters Business",
          url: "https://feeds.reuters.com/reuters/businessNews",
          category: "business",
          priority: "high",
          enabled: true,
          tags: ["business", "finance", "markets"]
        },
        {
          id: "bloomberg",
          name: "Bloomberg",
          url: "https://feeds.bloomberg.com/markets/news.rss",
          category: "finance",
          priority: "high",
          enabled: true,
          tags: ["markets", "finance", "economy"]
        },
        {
          id: "venturebeat",
          name: "VentureBeat",
          url: "https://venturebeat.com/feed/",
          category: "technology",
          priority: "medium",
          enabled: true,
          tags: ["technology", "ai", "startups"]
        }
      ],
      settings: {
        refreshIntervalMinutes: 5,
        timeoutSeconds: 30,
        retryAttempts: 3,
        retryDelayMs: 1000
      }
    };

    const eslintConfigPath = path.join(this.projectRoot, '.eslintrc.json');
    const eslintConfig = {
      env: {
        node: true,
        es2021: true,
        jest: true
      },
      extends: ["eslint:recommended"],
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module"
      },
      rules: {
        "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
        "no-console": "warn",
        "prefer-const": "error",
        "no-var": "error"
      }
    };

    const prettierConfigPath = path.join(this.projectRoot, '.prettierrc.json');
    const prettierConfig = {
      semi: true,
      trailingComma: "es5",
      singleQuote: true,
      printWidth: 80,
      tabWidth: 2,
      useTabs: false
    };

    try {
      await fs.writeFile(rssConfigPath, JSON.stringify(rssConfig, null, 2));
      await fs.writeFile(eslintConfigPath, JSON.stringify(eslintConfig, null, 2));
      await fs.writeFile(prettierConfigPath, JSON.stringify(prettierConfig, null, 2));
      console.log('  ✅ Created configuration files');
    } catch (error) {
      console.log('  ❌ Failed to create config files:', error.message);
    }
  }

  async checkSystemRequirements() {
    console.log('🔍 Checking system requirements...');
    
    const requirements = [
      { name: 'Node.js', command: 'node --version', minVersion: 'v18.0.0' },
      { name: 'npm', command: 'npm --version', minVersion: '9.0.0' },
    ];

    for (const req of requirements) {
      try {
        const version = execSync(req.command, { encoding: 'utf8' }).trim();
        console.log(`  ✅ ${req.name}: ${version}`);
      } catch (error) {
        console.log(`  ❌ ${req.name}: Not found or version too old`);
        console.log(`     Required: ${req.minVersion} or higher`);
      }
    }
  }

  async displayNextSteps() {
    console.log('\n🎉 Setup completed successfully!\n');
    console.log('📋 Next steps:');
    console.log('  1. Update .env file with your API keys and configuration');
    console.log('  2. Install dependencies: npm install');
    console.log('  3. Start MongoDB and Redis (or use Docker): docker-compose up -d mongodb redis');
    console.log('  4. Run the application: npm run dev');
    console.log('  5. Set up n8n workflows (optional): docker-compose up -d n8n');
    console.log('\n📚 Documentation:');
    console.log('  - API documentation will be available at: http://localhost:3000/docs');
    console.log('  - Health check endpoint: http://localhost:3000/health');
    console.log('  - Metrics endpoint: http://localhost:9090/metrics');
    console.log('\n🔧 Development commands:');
    console.log('  - npm run dev     # Start development server');
    console.log('  - npm test        # Run tests');
    console.log('  - npm run lint    # Run linter');
    console.log('  - docker-compose up # Start all services\n');
  }

  async run() {
    try {
      console.log('🚀 Setting up News Deduplication System...\n');
      
      await this.checkSystemRequirements();
      await this.createDirectories();
      await this.createEnvFile();
      await this.createGitignore();
      await this.createDockerFiles();
      await this.createConfigFiles();
      await this.displayNextSteps();
      
    } catch (error) {
      console.error('❌ Setup failed:', error.message);
      process.exit(1);
    }
  }
}

// Run setup if called directly
if (require.main === module) {
  const setup = new ProjectSetup();
  setup.run();
}

module.exports = ProjectSetup;