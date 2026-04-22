// src/queue/signalQueue.js

class SignalQueue {
  constructor(maxConcurrent = 2) {
    this.queue = [];
    this.active = new Map();
    this.maxConcurrent = maxConcurrent;

    console.log('✅ Signal queue initialized');
  }

  addSignal(signal) {
    // Будет реализовано в ПРОМТЕ 7
    console.log(`Adding signal: ${signal.pair}`);
  }

  getQueueStats() {
    return {
      active_count: this.active.size,
      queued_count: this.queue.length,
      max_concurrent: this.maxConcurrent,
    };
  }
}

module.exports = SignalQueue;

