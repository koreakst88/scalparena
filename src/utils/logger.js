// src/utils/logger.js

class Logger {
  static info(message) {
    console.log(`[INFO] ${new Date().toISOString()}: ${message}`);
  }

  static error(message, error = null) {
    console.error(`[ERROR] ${new Date().toISOString()}: ${message}`);
    if (error) console.error(error);
  }

  static warn(message) {
    console.warn(`[WARN] ${new Date().toISOString()}: ${message}`);
  }

  static debug(message) {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DEBUG] ${new Date().toISOString()}: ${message}`);
    }
  }
}

module.exports = Logger;

