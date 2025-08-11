const winston = require('winston');
const path = require('path');
const config = require('../config/config');

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
    let logMessage = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    
    // Add metadata if present
    if (Object.keys(meta).length > 0) {
      logMessage += ` ${JSON.stringify(meta)}`;
    }
    
    // Add stack trace for errors
    if (stack) {
      logMessage += `\n${stack}`;
    }
    
    return logMessage;
  })
);

// Console format with colors
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({
    format: 'HH:mm:ss'
  }),
  winston.format.printf(({ level, message, timestamp, ...meta }) => {
    let logMessage = `${timestamp} ${level}: ${message}`;
    
    if (Object.keys(meta).length > 0) {
      logMessage += ` ${JSON.stringify(meta, null, 2)}`;
    }
    
    return logMessage;
  })
);

// Create transports
const transports = [
  // Console transport
  new winston.transports.Console({
    format: consoleFormat,
    level: config.logging.level
  })
];

// File transport (if not in test environment)
if (config.env !== 'test') {
  transports.push(
    new winston.transports.File({
      filename: path.join(config.paths.logs, 'error.log'),
      level: 'error',
      format: logFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    new winston.transports.File({
      filename: path.join(config.paths.logs, 'combined.log'),
      format: logFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  );
}

// Create logger instance
const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  transports,
  // Don't exit on handled exceptions
  exitOnError: false
});

// Handle uncaught exceptions and unhandled rejections
if (config.env !== 'test') {
  logger.exceptions.handle(
    new winston.transports.File({
      filename: path.join(config.paths.logs, 'exceptions.log'),
      format: logFormat
    })
  );

  logger.rejections.handle(
    new winston.transports.File({
      filename: path.join(config.paths.logs, 'rejections.log'),
      format: logFormat
    })
  );
}

// Add custom methods for structured logging
logger.apiRequest = (req, res, duration) => {
  logger.info('API Request', {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    statusCode: res.statusCode,
    duration: `${duration}ms`,
    contentLength: res.get('Content-Length') || 0
  });
};

logger.database = (operation, collection, duration, count) => {
  logger.debug('Database Operation', {
    operation,
    collection,
    duration: `${duration}ms`,
    count
  });
};

logger.processing = (type, item, duration, status) => {
  logger.info('Processing', {
    type,
    item,
    duration: `${duration}ms`,
    status
  });
};

logger.alert = (type, recipient, status, error) => {
  const logData = {
    type,
    recipient,
    status,
    timestamp: new Date().toISOString()
  };
  
  if (error) {
    logData.error = error.message;
    logger.error('Alert Failed', logData);
  } else {
    logger.info('Alert Sent', logData);
  }
};

logger.metrics = (metricName, value, tags = {}) => {
  logger.debug('Metric', {
    metric: metricName,
    value,
    tags,
    timestamp: new Date().toISOString()
  });
};

module.exports = logger;