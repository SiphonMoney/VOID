// Console Logs Manager
// Handles logging from both extension (background) and server
// Stores and retrieves logs for display in popup

class ConsoleLogsManager {
  constructor() {
    this.maxLogs = 500; // Keep last 500 logs
    this.logSources = {
      EXTENSION: 'extension',
      SERVER: 'server'
    };
  }

  /**
   * Add a log entry from extension
   * @param {string} message - Log message
   * @param {string} type - Log type (info, error, success, warning)
   */
  async addExtensionLog(message, type = 'info') {
    await this.addLog(message, type, this.logSources.EXTENSION);
  }

  /**
   * Add a log entry from server
   * @param {string} message - Log message
   * @param {string} type - Log type (info, error, success, warning)
   */
  async addServerLog(message, type = 'info') {
    await this.addLog(message, type, this.logSources.SERVER);
  }

  /**
   * Add a log entry
   * @param {string} message - Log message
   * @param {string} type - Log type
   * @param {string} source - Log source (extension or server)
   */
  async addLog(message, type = 'info', source = 'extension') {
    const logEntry = {
      message: this.sanitizeMessage(message),
      type: type,
      source: source,
      timestamp: Date.now()
    };

    try {
      const result = await chrome.storage.local.get(['consoleLogs']);
      const logs = JSON.parse(result.consoleLogs || '[]');
      
      // Add new log
      logs.push(logEntry);
      
      // Keep only last maxLogs entries
      if (logs.length > this.maxLogs) {
        logs.splice(0, logs.length - this.maxLogs);
      }
      
      // Save back to storage
      await chrome.storage.local.set({ consoleLogs: JSON.stringify(logs) });
    } catch (error) {
      console.error('[ConsoleLogsManager] Error saving log:', error);
    }
  }

  /**
   * Get all logs
   * @returns {Promise<Array>} Array of log entries
   */
  async getLogs() {
    try {
      const result = await chrome.storage.local.get(['consoleLogs']);
      return JSON.parse(result.consoleLogs || '[]');
    } catch (error) {
      console.error('[ConsoleLogsManager] Error getting logs:', error);
      return [];
    }
  }

  /**
   * Clear all logs
   */
  async clearLogs() {
    try {
      await chrome.storage.local.set({ consoleLogs: JSON.stringify([]) });
    } catch (error) {
      console.error('[ConsoleLogsManager] Error clearing logs:', error);
    }
  }

  /**
   * Sanitize log message (remove sensitive data, truncate if too long)
   * @param {string} message - Raw log message
   * @returns {string} Sanitized message
   */
  sanitizeMessage(message) {
    let sanitized = String(message);
    
    // Remove private keys (hex strings starting with 0x followed by 64 hex chars)
    sanitized = sanitized.replace(/0x[a-fA-F0-9]{64}/g, '0x****');
    
    // Truncate very long messages
    if (sanitized.length > 1000) {
      sanitized = sanitized.substring(0, 1000) + '... [truncated]';
    }
    
    return sanitized;
  }

  /**
   * Format log for display
   * @param {Object} log - Log entry
   * @returns {string} Formatted HTML string
   */
  formatLog(log) {
    const timestamp = new Date(log.timestamp).toLocaleTimeString();
    const sourceLabel = log.source === this.logSources.SERVER ? '[SERVER]' : '[EXT]';
    const sourceClass = log.source === this.logSources.SERVER ? 'server' : 'extension';
    
    return `<div class="console-log ${log.type} ${sourceClass}">
      <span class="console-log timestamp">[${timestamp}]</span>
      <span class="console-log source">${sourceLabel}</span>
      ${this.escapeHtml(log.message)}
    </div>`;
  }

  /**
   * Escape HTML in log messages
   * @param {string} text - Text to escape
   * @returns {string} Escaped HTML
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.ConsoleLogsManager = ConsoleLogsManager;
}
