// Popup script - handles UI navigation, WebGL effects, and interactions

document.addEventListener('DOMContentLoaded', () => {
  // Screen navigation
  const mainScreen = document.getElementById('mainScreen');
  const transactionsScreen = document.getElementById('transactionsScreen');
  const settingsScreen = document.getElementById('settingsScreen');
  
  const shieldBtn = document.getElementById('shieldBtn');
  const transactionsBtn = document.getElementById('transactionsBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  
  // Console logs
  const consoleViewer = document.getElementById('consoleViewer');
  const consoleLogsToggle = document.getElementById('consoleLogsToggle');
  let logsExpanded = false;
  
  // Connection state
  const anonymizeBtn = document.getElementById('anonymizeBtn');
  const statusLog = document.getElementById('statusLog');
  let isConnected = false;
  
  // WebGL setup
  let glBackground = null;
  let glForeground = null;
  let glProgramBackground = null;
  let glProgramForeground = null;
  let animationFrameId = null;
  let time = 0;
  
  // Particle system
  const particleCanvas = document.getElementById('particleCanvas');
  let particleCtx = null;
  let particles = [];
  let particleAnimationId = null;
  
  // Check if all required elements exist
  if (!mainScreen || !transactionsScreen || !settingsScreen) {
    console.error('Required screen elements not found');
    return;
  }
  
  if (!shieldBtn || !transactionsBtn || !settingsBtn) {
    console.error('Required button elements not found');
    return;
  }
  
  // Initialize theme
  chrome.storage.local.get(['darkMode'], (result) => {
    const darkMode = result.darkMode !== false; // Default to dark
    if (darkMode) {
      document.body.classList.add('dark-mode');
      document.body.classList.remove('light-mode');
    } else {
      document.body.classList.add('light-mode');
      document.body.classList.remove('dark-mode');
    }
    if (document.getElementById('themeToggle')) {
      document.getElementById('themeToggle').checked = darkMode;
    }
  });
  
  // Initialize connection state
  chrome.storage.local.get(['isConnected'], (result) => {
    isConnected = result.isConnected === true;
    updateConnectionState(isConnected, false); // false = don't save, already loaded
  });
  
  // WebGL Shader Code
  const vertexShaderSource = `
    attribute vec2 a_position;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;
  
  const fragmentShaderBackgroundSource = `
    precision mediump float;
    uniform float t;
    uniform vec2 r;
    
    // Custom tanh function for vec2
    vec2 myTanh(vec2 x) {
      vec2 ex = exp(x);
      vec2 emx = exp(-x);
      return (ex - emx) / (ex + emx);
    }
    
    void main() {
      vec4 o_bg = vec4(0.0);

      // Background (Image) Layer - scaled smaller (2.0x)
      {
        vec2 p_img = (gl_FragCoord.xy * 2.0 - r) / r.y * 2.0 * mat2(1.0, -1.0, 1.0, 1.0);
        vec2 l_val = myTanh(p_img * 5.0 + 2.0);
        l_val = min(l_val, l_val * 3.0);
        vec2 clamped = clamp(l_val, -2.0, 0.0);
        float diff_y = clamped.y - l_val.y;
        float safe_px = abs(p_img.x) < 0.001 ? 0.001 : p_img.x;
        float term = (0.1 - max(0.01 - dot(p_img, p_img) / 200.0, 0.0) * (diff_y / safe_px))
                     / abs(length(p_img) - 0.7);
        o_bg += vec4(term);
        o_bg *= max(o_bg, vec4(0.0));
      }

      // Boost brightness and clamp
      vec4 finalColor = o_bg * 1.5;
      finalColor = clamp(finalColor, 0.0, 1.0);
      gl_FragColor = finalColor;
    }
  `;
  
  const fragmentShaderForegroundSource = `
    precision mediump float;
    uniform float t;
    uniform vec2 r;
    
    void main() {
      vec4 o_anim = vec4(0.0);

      // Foreground (Animation) Layer - scaled smaller (2.0x)
      {
        vec2 p_anim = (gl_FragCoord.xy * 2.0 - r) / r.y / 0.7 * 2.0;
        vec2 d = vec2(-1.0, 1.0);
        float denom = 0.1 + 5.0 / dot(5.0 * p_anim - d, 5.0 * p_anim - d);
        vec2 c = p_anim * mat2(1.0, 1.0, d.x / denom, d.y / denom);
        vec2 v = c;
        float angle = log(length(v)) + t * 0.2;
        float cos_a = cos(angle + 33.0);
        float sin_a = sin(angle + 11.0);
        v *= mat2(cos_a, -sin_a, sin_a, cos_a) * 5.0;
        vec4 animAccum = vec4(0.0);
        for (int i = 1; i <= 9; i++) {
          float fi = float(i);
          animAccum += sin(vec4(v.x, v.y, v.y, v.x)) + vec4(1.0);
          v += 0.7 * sin(vec2(v.y, v.x) * fi + t) / fi + 0.5;
        }
        vec4 animTerm = 1.0 - exp(-exp(c.x * vec4(0.6, -0.4, -1.0, 0.0))
                          / animAccum
                          / (0.1 + 0.1 * pow(length(sin(v / 0.3) * 0.2 + c * vec2(1.0, 2.0)) - 1.0, 2.0))
                          / (1.0 + 7.0 * exp(0.3 * c.y - dot(c, c)))
                          / (0.03 + abs(length(p_anim) - 0.7)) * 0.2);
        o_anim += animTerm;
      }

      // Boost brightness and clamp
      vec4 finalColor = o_anim * 1.5;
      finalColor = clamp(finalColor, 0.0, 1.0);
      gl_FragColor = finalColor;
    }
  `;
  
  // WebGL utility functions
  function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compilation error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }
  
  function createProgram(gl, vertexShader, fragmentShader) {
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program linking error:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }
  
  function initWebGL(canvas, fragmentSource) {
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
      console.error('WebGL not supported');
      return null;
    }
    
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = createProgram(gl, vertexShader, fragmentShader);
    
    if (!program) return null;
    
    // Set viewport
    gl.viewport(0, 0, canvas.width, canvas.height);
    
    // Clear color - transparent black
    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    // Create quad
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    const positions = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    
    const positionLocation = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    
    return { gl, program, positionLocation };
  }
  
  function setupWebGL() {
    const canvasBg = document.getElementById('glcanvas');
    const canvasFg = document.getElementById('glcanvasForeground');
    
    if (!canvasBg || !canvasFg) {
      console.error('Canvas elements not found');
      return;
    }
    
    // Set canvas size
    canvasBg.width = 280;
    canvasBg.height = 400;
    canvasFg.width = 280;
    canvasFg.height = 400;
    
    // Initialize WebGL
    const bgSetup = initWebGL(canvasBg, fragmentShaderBackgroundSource);
    const fgSetup = initWebGL(canvasFg, fragmentShaderForegroundSource);
    
    if (!bgSetup) {
      console.error('Background WebGL setup failed');
    }
    if (!fgSetup) {
      console.error('Foreground WebGL setup failed');
    }
    
    if (bgSetup && fgSetup) {
      glBackground = bgSetup.gl;
      glForeground = fgSetup.gl;
      glProgramBackground = bgSetup.program;
      glProgramForeground = fgSetup.program;
      
      // Start animation
      animate();
    } else {
      console.error('WebGL initialization failed');
    }
  }
  
  function animate() {
    if (!glBackground || !glForeground) return;
    
    // Use performance.now() for time like the original
    if (!window.startTime) {
      window.startTime = performance.now();
    }
    const currentTime = (performance.now() - window.startTime) / 1000.0;
    
    // Background - always render
    glBackground.viewport(0, 0, 280, 400);
    glBackground.clearColor(0.0, 0.0, 0.0, 1.0);
    glBackground.clear(glBackground.COLOR_BUFFER_BIT);
    
    glBackground.useProgram(glProgramBackground);
    const timeLocBg = glBackground.getUniformLocation(glProgramBackground, 't');
    const resLocBg = glBackground.getUniformLocation(glProgramBackground, 'r');
    glBackground.uniform1f(timeLocBg, currentTime);
    glBackground.uniform2f(resLocBg, 280, 400);
    glBackground.drawArrays(glBackground.TRIANGLES, 0, 6);
    
    // Foreground - render always but opacity controlled by CSS
    const foregroundCanvas = document.getElementById('glcanvasForeground');
    if (foregroundCanvas) {
      glForeground.viewport(0, 0, 280, 400);
      glForeground.clearColor(0.0, 0.0, 0.0, 0.0);
      glForeground.clear(glForeground.COLOR_BUFFER_BIT);
      
      glForeground.useProgram(glProgramForeground);
      const timeLocFg = glForeground.getUniformLocation(glProgramForeground, 't');
      const resLocFg = glForeground.getUniformLocation(glProgramForeground, 'r');
      glForeground.uniform1f(timeLocFg, currentTime);
      glForeground.uniform2f(resLocFg, 280, 400);
      glForeground.drawArrays(glForeground.TRIANGLES, 0, 6);
    }
    
    animationFrameId = requestAnimationFrame(animate);
  }
  
  // Particle system
  function initParticles() {
    if (!particleCanvas) return;
    particleCtx = particleCanvas.getContext('2d');
    particleCanvas.width = 280;
    particleCanvas.height = 400;
    
    // Create particles - smaller size
    for (let i = 0; i < 50; i++) {
      particles.push({
        x: Math.random() * 280,
        y: Math.random() * 400,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        size: Math.random() * 0.8 + 0.3, // Smaller particles (0.3-1.1px)
        opacity: Math.random() * 0.4 + 0.15 // Lower opacity
      });
    }
  }
  
  function animateParticles() {
    if (!particleCtx || !isConnected) {
      particles = [];
      return;
    }
    
    particleCtx.clearRect(0, 0, 280, 400);
    
    particles.forEach(particle => {
      particle.x += particle.vx;
      particle.y += particle.vy;
      
      // Wrap around
      if (particle.x < 0) particle.x = 280;
      if (particle.x > 280) particle.x = 0;
      if (particle.y < 0) particle.y = 400;
      if (particle.y > 400) particle.y = 0;
      
      particleCtx.fillStyle = `rgba(255, 255, 255, ${particle.opacity})`;
      particleCtx.beginPath();
      particleCtx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      particleCtx.fill();
    });
    
    particleAnimationId = requestAnimationFrame(animateParticles);
  }
  
  function startParticles() {
    if (particleAnimationId) return;
    particleCanvas.style.display = 'block';
    initParticles();
    // Fade in particles
    setTimeout(() => {
      particleCanvas.classList.add('active');
    }, 10);
    animateParticles();
  }
  
  function stopParticles() {
    // Fade out particles
    if (particleCanvas) {
      particleCanvas.classList.remove('active');
    }
    
    // Stop animation after fade
    setTimeout(() => {
      if (particleAnimationId) {
        cancelAnimationFrame(particleAnimationId);
        particleAnimationId = null;
      }
      particleCanvas.style.display = 'none';
      if (particleCtx) {
        particleCtx.clearRect(0, 0, 280, 400);
      }
      particles = [];
    }, 800); // Wait for fade transition
  }
  
  // Connection state management
  function updateConnectionState(connected, saveState = true) {
    isConnected = connected;
    
    if (statusLog) {
      statusLog.textContent = connected ? 'Connected' : 'Disconnected';
      statusLog.className = 'text text--status';
      if (connected) {
        statusLog.classList.add('connected');
      } else {
        statusLog.classList.add('disconnected');
      }
    }
    
    // Update foreground canvas opacity
    const foregroundCanvas = document.getElementById('glcanvasForeground');
    if (foregroundCanvas) {
      if (connected) {
        foregroundCanvas.style.opacity = '1';
      } else {
        foregroundCanvas.style.opacity = '0';
      }
    }
    
    // Update extension icon color (red when connected)
    if (saveState) {
      // Always try direct update first (more reliable)
      updateIconDirectly(connected);
      
      // Also send message to background script
      chrome.runtime.sendMessage({
        type: 'UPDATE_ICON',
        connected: connected
      }).catch(() => {
        // Ignore errors, direct update already attempted
      });
    }
    
    // Particles
    if (connected) {
      startParticles();
    } else {
      stopParticles();
    }
    
    // Save state
    if (saveState) {
      chrome.storage.local.set({ isConnected: connected });
    }
  }
  
  // Connection toggle
  if (anonymizeBtn) {
    anonymizeBtn.addEventListener('click', () => {
      if (isConnected) {
        // Disconnect
        updateConnectionState(false);
        if (statusLog) {
          statusLog.classList.remove('connecting');
        }
      } else {
        // Connect
        if (statusLog) {
          statusLog.textContent = 'Connecting';
          statusLog.className = 'text text--status connecting';
        }
        
        // Simulate connection delay
        setTimeout(() => {
          updateConnectionState(true);
        }, 1000);
      }
    });
  }
  
  // Show screen function
  function showScreen(screenId) {
    // Hide all screens
    if (mainScreen) mainScreen.classList.remove('active');
    if (transactionsScreen) transactionsScreen.classList.remove('active');
    if (settingsScreen) settingsScreen.classList.remove('active');
    
    // Remove active state from all buttons
    if (shieldBtn) shieldBtn.classList.remove('active');
    if (transactionsBtn) transactionsBtn.classList.remove('active');
    if (settingsBtn) settingsBtn.classList.remove('active');
    
    // Show selected screen
    if (screenId === 'main' && mainScreen) {
      mainScreen.classList.add('active');
    } else if (screenId === 'transactions' && transactionsScreen) {
      transactionsScreen.classList.add('active');
      if (transactionsBtn) transactionsBtn.classList.add('active');
    } else if (screenId === 'settings' && settingsScreen) {
      settingsScreen.classList.add('active');
      if (settingsBtn) settingsBtn.classList.add('active');
      setTimeout(loadConsoleLogs, 100);
      loadRpcSettings();
    }
  }
  
  // Icon button click handlers
  if (shieldBtn) {
    shieldBtn.addEventListener('click', () => {
      showScreen('main');
    });
  }
  
  if (transactionsBtn) {
    transactionsBtn.addEventListener('click', () => {
      showScreen('transactions');
    });
  }
  
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      showScreen('settings');
    });
  }
  
  // Console logs toggle
  if (consoleLogsToggle && consoleViewer) {
    consoleLogsToggle.addEventListener('change', () => {
      logsExpanded = consoleLogsToggle.checked;
      if (logsExpanded) {
        consoleViewer.classList.remove('collapsed');
        consoleViewer.classList.add('expanded');
        loadConsoleLogs();
      } else {
        consoleViewer.classList.add('collapsed');
        consoleViewer.classList.remove('expanded');
      }
    });
    
    // Load initial state
    chrome.storage.local.get(['consoleLogsEnabled'], (result) => {
      const enabled = result.consoleLogsEnabled === true;
      consoleLogsToggle.checked = enabled;
      logsExpanded = enabled;
      if (enabled) {
        consoleViewer.classList.remove('collapsed');
        consoleViewer.classList.add('expanded');
        loadConsoleLogs();
      }
    });
  }
  
  // Load console logs
  async function loadConsoleLogs() {
    if (!consoleViewer) return;
    if (!logsExpanded && !consoleViewer.classList.contains('expanded')) {
      return;
    }
    
    chrome.storage.local.get(['consoleLogs'], async (result) => {
      const extensionLogs = JSON.parse(result.consoleLogs || '[]');
      
      // Fetch server logs
      let serverLogs = [];
      try {
        const teeEndpoint = 'http://localhost:3001';
        const response = await fetch(`${teeEndpoint}/api/server-logs`);
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.logs) {
            serverLogs = data.logs;
          }
        }
      } catch (error) {
        // Server might not be running
      }
      
      const allLogs = [...extensionLogs, ...serverLogs]
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(-200);
      
      if (allLogs.length === 0) {
        consoleViewer.innerHTML = '<div class="console-log">No logs yet. Logs will appear here when extension is active.</div>';
        return;
      }
      
      if (typeof ConsoleLogsManager !== 'undefined') {
        const logsManager = new ConsoleLogsManager();
        consoleViewer.innerHTML = allLogs.map(log => logsManager.formatLog(log)).join('');
      } else {
        consoleViewer.innerHTML = allLogs.map(log => {
          const timestamp = new Date(log.timestamp).toLocaleTimeString();
          const sourceLabel = log.source === 'server' ? '[SERVER]' : '[EXT]';
          return `<div class="console-log ${log.type} ${log.source}">
            <span class="console-log timestamp">[${timestamp}]</span>
            <span class="console-log source">${sourceLabel}</span>
            ${escapeHtml(log.message)}
          </div>`;
        }).join('');
      }
      
      setTimeout(() => {
        consoleViewer.scrollTop = consoleViewer.scrollHeight;
      }, 50);
    });
  }
  
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  // Theme toggle
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('change', (e) => {
      const darkMode = e.target.checked;
      chrome.storage.local.set({ darkMode: darkMode });
      if (darkMode) {
        document.body.classList.add('dark-mode');
        document.body.classList.remove('light-mode');
      } else {
        document.body.classList.add('light-mode');
        document.body.classList.remove('dark-mode');
      }
    });
  }
  
  // RPC Selection
  const rpcSelector = document.getElementById('rpcSelector');
  const customRpcContainer = document.getElementById('customRpcContainer');
  const customRpcInput = document.getElementById('customRpcInput');
  const saveRpcBtn = document.getElementById('saveRpcBtn');
  
  function loadRpcSettings() {
    if (!rpcSelector || !customRpcInput || !customRpcContainer) return;
    
    chrome.storage.local.get(['teeRpcStrategy', 'customRpcUrl'], (result) => {
      const strategy = result.teeRpcStrategy || 'default';
      const customRpc = result.customRpcUrl || '';
      
      rpcSelector.value = strategy;
      customRpcInput.value = customRpc;
      
      if (strategy === 'custom') {
        customRpcContainer.style.display = 'flex';
      } else {
        customRpcContainer.style.display = 'none';
      }
    });
  }
  
  if (rpcSelector && customRpcContainer) {
    rpcSelector.addEventListener('change', (e) => {
      const strategy = e.target.value;
      
      if (strategy === 'custom') {
        customRpcContainer.style.display = 'flex';
      } else {
        customRpcContainer.style.display = 'none';
        chrome.storage.local.set({ teeRpcStrategy: strategy });
        
        chrome.runtime.sendMessage({
          type: 'UPDATE_TEE_RPC_STRATEGY',
          strategy: strategy
        });
      }
    });
  }
  
  if (saveRpcBtn && customRpcInput) {
    saveRpcBtn.addEventListener('click', () => {
      const customRpc = customRpcInput.value.trim();
      if (customRpc && customRpc.startsWith('http')) {
        chrome.storage.local.set({
          teeRpcStrategy: 'custom',
          customRpcUrl: customRpc
        });
        
        chrome.runtime.sendMessage({
          type: 'UPDATE_TEE_RPC_STRATEGY',
          strategy: 'custom',
          customRpc: customRpc
        });
        
        alert('Custom RPC saved!');
      } else {
        alert('Please enter a valid RPC URL (must start with http)');
      }
    });
  }
  
  // Save console logs toggle state
  if (consoleLogsToggle) {
    consoleLogsToggle.addEventListener('change', () => {
      chrome.storage.local.set({ consoleLogsEnabled: consoleLogsToggle.checked });
    });
  }
  
  // Helper function to update icon directly
  function updateIconDirectly(connected) {
    chrome.action.setIcon({
      path: connected ? {
        16: 'assets/void_icon_active_16.png',
        48: 'assets/void_icon_active_48.png',
        128: 'assets/void_icon_active_128.png'
      } : {
        16: 'assets/void_icon_16.png',
        48: 'assets/void_icon_48.png',
        128: 'assets/void_icon_128.png'
      }
    }).catch((err) => {
      console.log('Icon update error:', err);
    });
  }
  
  // Initialize
  showScreen('main');
  loadRpcSettings();
  setupWebGL();
  
  // Refresh logs every 2 seconds when settings is active and expanded
  setInterval(() => {
    if (settingsScreen && settingsScreen.classList.contains('active') && logsExpanded) {
      loadConsoleLogs();
    }
  }, 2000);
});
