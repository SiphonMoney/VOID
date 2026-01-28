// Porto Blocker
// Aggressively blocks Porto (id.porto.sh) wallet connector from intercepting transactions
// This prevents double intent confirmations

(function() {
  'use strict';

  // Prevent double injection
  if (window.__ANONYMAUS_PORTO_BLOCKER__) {
    return;
  }
  window.__ANONYMAUS_PORTO_BLOCKER__ = true;

  console.log('%c🚫 [AnonyMaus] Porto Blocker loaded - blocking id.porto.sh', 'color: #ff1493; font-weight: bold;');

  // Helper to detect Porto
  function isPorto(provider, info) {
    if (!provider && !info) return false;
    
    // Check provider info
    if (info) {
      const name = (info.name || '').toLowerCase();
      const rdns = (info.rdns || '').toLowerCase();
      const uuid = (info.uuid || '').toLowerCase();
      
      if (name.includes('porto') || rdns.includes('porto') || uuid.includes('porto')) {
        return true;
      }
    }
    
    // Check provider properties
    if (provider) {
      if (provider.isPorto || provider._isPorto) {
        return true;
      }
      
      // Check if provider has Porto-related methods or properties
      // Avoid JSON.stringify on provider object (circular references)
      if (typeof provider === 'object') {
        try {
          // Check specific known properties that might indicate Porto
          const checkProps = ['name', 'rdns', 'uuid', 'id', 'providerName'];
          for (const prop of checkProps) {
            if (provider[prop] && typeof provider[prop] === 'string') {
              const propValue = provider[prop].toLowerCase();
              if (propValue.includes('porto') || propValue.includes('id.porto.sh')) {
                return true;
              }
            }
          }
          
          // Check constructor name
          if (provider.constructor && provider.constructor.name) {
            const constructorName = provider.constructor.name.toLowerCase();
            if (constructorName.includes('porto')) {
              return true;
            }
          }
        } catch (e) {
          // If we can't check safely, assume it's not Porto
          // The info object check above should catch most cases
        }
      }
    }
    
    // Check URL/referrer
    try {
      if (typeof window !== 'undefined') {
        const url = window.location.href.toLowerCase();
        const referrer = document.referrer.toLowerCase();
        if (url.includes('porto.sh') || referrer.includes('porto.sh')) {
          return true;
        }
      }
    } catch (e) {
      // Ignore errors
    }
    
    return false;
  }

  // Block Porto's EIP-6963 provider announcement
  const originalDispatchEvent = window.dispatchEvent;
  window.dispatchEvent = function(event) {
    // Block Porto's EIP-6963 announcement
    if (event.type === 'eip6963:announceProvider' && event.detail) {
      const { info, provider } = event.detail;
      if (isPorto(provider, info)) {
        console.log('%c🚫 [AnonyMaus] BLOCKED Porto EIP-6963 announcement', 'color: #ff1493; font-weight: bold;');
        return false; // Block the event
      }
    }
    
    // Also protect MetaMask after any provider announcement
    if (event.type === 'eip6963:announceProvider') {
      setTimeout(interceptMetaMaskProvider, 0);
    }
    
    return originalDispatchEvent.call(this, event);
  };

  // Intercept EIP-6963 requestProvider events and filter out Porto
  const originalAddEventListener = window.addEventListener;
  window.addEventListener = function(type, listener, options) {
    if (type === 'eip6963:announceProvider') {
      // Wrap the listener to filter out Porto
      const wrappedListener = function(event) {
        if (event.detail) {
          const { info, provider } = event.detail;
          if (isPorto(provider, info)) {
            console.log('%c🚫 [AnonyMaus] BLOCKED Porto provider from listener', 'color: #ff1493; font-weight: bold;');
            return; // Don't call the listener for Porto
          }
        }
        return listener.call(this, event);
      };
      return originalAddEventListener.call(this, type, wrappedListener, options);
    }
    
    return originalAddEventListener.call(this, type, listener, options);
  };

  // Block Porto providers from being stored in window.ethereum.providers
  if (window.ethereum && window.ethereum.providers) {
    const originalProviders = window.ethereum.providers;
    Object.defineProperty(window.ethereum, 'providers', {
      get: function() {
        const providers = originalProviders.filter(p => !isPorto(p));
        if (providers.length !== originalProviders.length) {
          console.log('%c🚫 [AnonyMaus] Filtered out Porto from providers array', 'color: #ff1493; font-weight: bold;');
        }
        return providers;
      },
      set: function(value) {
        if (Array.isArray(value)) {
          const filtered = value.filter(p => !isPorto(p));
          if (filtered.length !== value.length) {
            console.log('%c🚫 [AnonyMaus] Filtered out Porto from providers array (set)', 'color: #ff1493; font-weight: bold;');
          }
          originalProviders.length = 0;
          originalProviders.push(...filtered);
        } else {
          originalProviders.length = 0;
          if (value) {
            originalProviders.push(value);
          }
        }
      },
      configurable: true,
      enumerable: true
    });
  }

  // Intercept MetaMask provider BEFORE Porto can wrap it
  // This is critical - we need to intercept at the source
  function interceptMetaMaskProvider() {
    if (!window.ethereum) return;
    
    // Find the actual MetaMask provider (not wrapped by Porto)
    let metamaskProvider = null;
    
    if (window.ethereum.isMetaMask && !isPorto(window.ethereum)) {
      metamaskProvider = window.ethereum;
    } else if (window.ethereum.providers) {
      metamaskProvider = window.ethereum.providers.find(p => p.isMetaMask && !isPorto(p));
    }
    
    if (!metamaskProvider) return;
    
    // If already intercepted, skip
    if (metamaskProvider.__ANONYMAUS_METAMASK_PROTECTED__) return;
    metamaskProvider.__ANONYMAUS_METAMASK_PROTECTED__ = true;
    
    // Store original methods
    const originalRequest = metamaskProvider.request.bind(metamaskProvider);
    const originalOn = metamaskProvider.on ? metamaskProvider.on.bind(metamaskProvider) : null;
    const originalAddListener = metamaskProvider.addListener ? metamaskProvider.addListener.bind(metamaskProvider) : null;
    
    // Wrap request to block Porto from intercepting transactions
    metamaskProvider.request = function(args) {
      const method = typeof args === 'string' ? args : (args.method || 'unknown');
      const params = typeof args === 'string' ? [] : (args.params || []);
      const tx = params[0] || args;
      
      // BYPASS Porto blocker for deposit transactions (0xd0e30db0 = deposit() function)
      // Deposit transactions must go directly to MetaMask
      const isDeposit = tx && tx.data && (
        tx.data === '0xd0e30db0' || 
        tx.data.toLowerCase() === '0xd0e30db0' ||
        tx.data.startsWith('0xd0e30db0')
      );
      
      if (isDeposit) {
        console.log(`%c💰 [AnonyMaus] Deposit transaction - bypassing Porto blocker`, 'color: #4caf50; font-weight: bold;');
        // Allow deposit transactions through directly
        return originalRequest.call(this, args);
      }
      
      // For transaction methods, check if this is from Porto
      if (method === 'eth_sendTransaction' || method === 'eth_sendRawTransaction') {
        // Check call stack to see if Porto is in the chain
        // Be more specific - only block if it's clearly from Porto's code
        try {
          const stack = new Error().stack || '';
          const stackLower = stack.toLowerCase();
          // Only block if stack contains Porto-specific identifiers (not just "porto" in file paths)
          if (stackLower.includes('id.porto.sh') || 
              stackLower.includes('porto-wallet') ||
              (stackLower.includes('porto') && (stackLower.includes('connector') || stackLower.includes('wallet')))) {
            console.log('%c🚫 [AnonyMaus] BLOCKED Porto transaction request to MetaMask', 'color: #ff1493; font-weight: bold;');
            return Promise.reject(new Error('AnonyMaus: Porto wallet connector is blocked. Please use AnonyMaus or MetaMask directly.'));
          }
        } catch (e) {
          // Ignore stack trace errors
        }
      }
      
      // For signing methods, also check for Porto
      if (method === 'personal_sign' || method === 'eth_sign' || method === 'eth_signTypedData' || method === 'eth_signTypedData_v4') {
        try {
          const stack = new Error().stack || '';
          const stackLower = stack.toLowerCase();
          // Only block if stack contains Porto-specific identifiers
          if (stackLower.includes('id.porto.sh') || 
              stackLower.includes('porto-wallet') ||
              (stackLower.includes('porto') && (stackLower.includes('connector') || stackLower.includes('wallet')))) {
            console.log('%c🚫 [AnonyMaus] BLOCKED Porto signing request to MetaMask', 'color: #ff1493; font-weight: bold;');
            return Promise.reject(new Error('AnonyMaus: Porto wallet connector is blocked.'));
          }
        } catch (e) {
          // Ignore stack trace errors
        }
      }
      
      // Allow through to MetaMask
      return originalRequest.call(this, args);
    };
    
    // Block Porto from listening to MetaMask events
    if (originalOn) {
      metamaskProvider.on = function(event, listener) {
        // Check if listener is from Porto
        try {
          const listenerStr = listener.toString().toLowerCase();
          if (listenerStr.includes('porto') || listenerStr.includes('id.porto.sh')) {
            console.log('%c🚫 [AnonyMaus] BLOCKED Porto event listener on MetaMask', 'color: #ff1493; font-weight: bold;');
            return; // Don't register the listener
          }
        } catch (e) {
          // Ignore errors
        }
        return originalOn.call(this, event, listener);
      };
    }
    
    if (originalAddListener) {
      metamaskProvider.addListener = function(event, listener) {
        // Check if listener is from Porto
        try {
          const listenerStr = listener.toString().toLowerCase();
          if (listenerStr.includes('porto') || listenerStr.includes('id.porto.sh')) {
            console.log('%c🚫 [AnonyMaus] BLOCKED Porto event listener on MetaMask', 'color: #ff1493; font-weight: bold;');
            return; // Don't register the listener
          }
        } catch (e) {
          // Ignore errors
        }
        return originalAddListener.call(this, event, listener);
      };
    }
    
    console.log('%c🛡️ [AnonyMaus] Protected MetaMask provider from Porto interception', 'color: #4caf50; font-weight: bold;');
  }

  // Intercept Porto's provider if it's already set
  function blockPortoProvider() {
    if (window.ethereum) {
      // Check if ethereum itself is Porto
      if (isPorto(window.ethereum)) {
        console.log('%c🚫 [AnonyMaus] window.ethereum is Porto - blocking', 'color: #ff1493; font-weight: bold;');
        // Don't replace it, but intercept its methods
        interceptPortoProvider(window.ethereum);
      }
      
      // Check providers array
      if (window.ethereum.providers && Array.isArray(window.ethereum.providers)) {
        window.ethereum.providers.forEach((provider, index) => {
          if (isPorto(provider)) {
            console.log('%c🚫 [AnonyMaus] Found Porto in providers array - blocking', 'color: #ff1493; font-weight: bold;');
            interceptPortoProvider(provider);
          }
        });
      }
    }
    
    // Protect MetaMask from Porto
    interceptMetaMaskProvider();
  }

  // Intercept Porto provider methods to block transactions
  function interceptPortoProvider(provider) {
    if (!provider || provider.__ANONYMAUS_BLOCKED__) {
      return;
    }
    provider.__ANONYMAUS_BLOCKED__ = true;

    // Block transaction methods
    const originalRequest = provider.request;
    if (originalRequest) {
      provider.request = function(args) {
        const method = typeof args === 'string' ? args : (args.method || 'unknown');
        
        // Block all transaction and signing methods from Porto
        if (method === 'eth_sendTransaction' || 
            method === 'eth_sendRawTransaction' ||
            method === 'personal_sign' ||
            method === 'eth_sign' ||
            method === 'eth_signTypedData' ||
            method === 'eth_signTypedData_v4' ||
            (typeof method === 'string' && method.toLowerCase().includes('sendtransaction')) ||
            (typeof method === 'string' && method.toLowerCase().includes('sign'))) {
          
          console.log(`%c🚫 [AnonyMaus] BLOCKED Porto ${method} request`, 'color: #ff1493; font-weight: bold;');
          return Promise.reject(new Error('AnonyMaus: Porto wallet connector is blocked. Please use AnonyMaus or MetaMask directly.'));
        }
        
        // Allow read methods to pass through (but log them)
        return originalRequest.call(this, args);
      };
    }

    // Block legacy methods
    if (provider.send) {
      const originalSend = provider.send;
      provider.send = function(method, params) {
        if (typeof method === 'string' && (
          method.toLowerCase().includes('sendtransaction') ||
          method.toLowerCase().includes('sign')
        )) {
          console.log(`%c🚫 [AnonyMaus] BLOCKED Porto send(${method})`, 'color: #ff1493; font-weight: bold;');
          return Promise.reject(new Error('AnonyMaus: Porto wallet connector is blocked.'));
        }
        return originalSend.call(this, method, params);
      };
    }

    if (provider.sendAsync) {
      const originalSendAsync = provider.sendAsync;
      provider.sendAsync = function(payload, callback) {
        if (payload.method && (
          payload.method.toLowerCase().includes('sendtransaction') ||
          payload.method.toLowerCase().includes('sign')
        )) {
          console.log(`%c🚫 [AnonyMaus] BLOCKED Porto sendAsync(${payload.method})`, 'color: #ff1493; font-weight: bold;');
          if (callback) {
            callback(new Error('AnonyMaus: Porto wallet connector is blocked.'));
          }
          return;
        }
        return originalSendAsync.call(this, payload, callback);
      };
    }
  }

  // Block Porto iframes
  function blockPortoIframes() {
    try {
      // Find and block Porto iframes
      const iframes = document.querySelectorAll('iframe');
      iframes.forEach(iframe => {
        try {
          const src = iframe.src || '';
          if (src.includes('porto.sh')) {
            console.log('%c🚫 [AnonyMaus] Found Porto iframe - blocking', 'color: #ff1493; font-weight: bold;');
            iframe.style.display = 'none';
            iframe.remove();
          }
        } catch (e) {
          // Cross-origin iframe, can't access src
        }
      });

      // Watch for new iframes
      const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
          mutation.addedNodes.forEach(node => {
            if (node.tagName === 'IFRAME') {
              try {
                const src = node.src || '';
                if (src.includes('porto.sh')) {
                  console.log('%c🚫 [AnonyMaus] Blocked new Porto iframe', 'color: #ff1493; font-weight: bold;');
                  node.style.display = 'none';
                  node.remove();
                }
              } catch (e) {
                // Ignore
              }
            }
          });
        });
      });

      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
      });
    } catch (e) {
      // Ignore errors
    }
  }

  // Intercept window.ethereum setter to protect MetaMask immediately
  let currentEthereum = window.ethereum;
  Object.defineProperty(window, 'ethereum', {
    get: function() {
      return currentEthereum;
    },
    set: function(value) {
      currentEthereum = value;
      // Immediately protect MetaMask and block Porto
      setTimeout(() => {
        blockPortoProvider();
        interceptMetaMaskProvider();
      }, 0);
    },
    configurable: true,
    enumerable: true
  });

  // Run blocking immediately
  blockPortoProvider();
  blockPortoIframes();
  interceptMetaMaskProvider();

  // Also run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      blockPortoProvider();
      blockPortoIframes();
      interceptMetaMaskProvider();
    });
  } else {
    setTimeout(() => {
      blockPortoProvider();
      blockPortoIframes();
      interceptMetaMaskProvider();
    }, 100);
  }

  // Continuously monitor for Porto and protect MetaMask
  setInterval(() => {
    blockPortoProvider();
    interceptMetaMaskProvider();
  }, 500); // Check more frequently

  console.log('%c✅ [AnonyMaus] Porto Blocker active - monitoring for Porto', 'color: #4caf50; font-weight: bold;');
})();

