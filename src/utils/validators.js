// src/utils/validators.js

class Validators {
  static isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  static requireEnv(name) {
    const value = process.env[name];
    if (!Validators.isNonEmptyString(value)) {
      throw new Error(`Missing required env var: ${name}`);
    }
    return value;
  }
}

module.exports = Validators;

