// js/enhanced-dashboard.js - Main Dashboard Controller
class AGRINOVADashboard {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.currentLanguage = 'en';
    this.alerts = [];
    this.sensorData = {
      weather: {},
      soil: {},
      crop: {},
      market: []
    };
    this.priceChart = null;
    
    this.init();
  }

  async init() {
    console.log('🌾 Initializing AGRINOVA Pro Dashboard...');
    
    // Initialize components
    this.setupSocketConnection();
    this.setupEventListeners();
    this.setupLocationServices();
    this.setupVoiceAssistant();
    this.setupCameraCapture();
    this.initializePriceChart();
    
    // Start background services
    this.startBackgroundUpdates();
    
    console.log('✅ AGRINOVA Pro Dashboard initialized');
  }

  // Socket.IO Connection Management
  setupSocketConnection() {
    try {
      this.socket = io('http://localhost:4000', {
        transports: ['websocket', 'polling']
      });

      this.socket.on('connect', () => {
        console.log('🔗 Connected to AGRINOVA IoT Server');
        this.isConnected = true;
        this.updateConnectionStatus('iot', true);
        this.showNotification('Connected to IoT System', 'success');
      });

      this.socket.on('disconnect', () => {
        console.log('❌ Disconnected from IoT Server');
        this.isConnected = false;
        this.updateConnectionStatus('iot', false);
        this.showNotification('IoT Connection Lost', 'error');
      });

      this.socket.on('iotUpdate', (data) => {
        this.handleIoTUpdate(data);
      });

      this.socket.on('alert', (alert) => {
        this.handleNewAlert(alert);
      });

      this.socket.on('dailyAdvisory', (advisory) => {
        this.handleDailyAdvisory(advisory);
      });

    } catch (error) {
      console.error('Socket connection failed:', error);
      this.updateConnectionStatus('iot', false);
    }
  }

  // Event Listeners Setup
  setupEventListeners() {
    // Language selection
    document.getElementById('languageSelect').addEventListener('change', (e) => {
      this.changeLanguage(e.target.value);
    });

    // Alert panel toggle
    document.getElementById('alertsBtn').addEventListener('click', () => {
      this.toggleAlertPanel();
    });

    document.getElementById('closeAlerts').addEventListener('click', () => {
      this.toggleAlertPanel();
    });

    // Device control buttons
    document.getElementById('irrigationBtn').addEventListener('click', () => {
      this.controlDevice('irrigation', 'toggle');
    });

    document.getElementById('fertilizerBtn').addEventListener('click', () => {
      this.controlDevice('fertilizer', 'dispense');
    });

    document.getElementById('pestBtn').addEventListener('click', () => {
      this.controlDevice('pestControl', 'spray');
    });

    // Image upload for disease detection
    document.getElementById('uploadBtn').addEventListener('click', () => {
      document.getElementById('leafUpload').click();
    });

    document.getElementById('leafUpload').addEventListener('change', (e) => {
      if (e.target.files[0]) {
        this.analyzeCropImage(e.target.files[0]);
      }
    });

    // Auto irrigation toggle
    document.getElementById('autoIrrigation').addEventListener('change', (e) => {
      this.toggleAutoIrrigation(e.target.checked);
    });

    // Voice assistant
    document.getElementById('voiceBtn').addEventListener('click', () => {
      this.startVoiceInteraction();
    });
  }

  // Location Services
  async setupLocationServices() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          console.log(`📍 Location: ${latitude}, ${longitude}`);
          this.fetchWeatherData(latitude, longitude);
        },
        (error) => {
          console.warn('Location access denied:', error);
          this.loadMockWeatherData();
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      this.loadMockWeatherData();
    }
  }

  // Weather Data Management
  async fetchWeatherData(lat, lon) {
    try {
      // Request weather data from server
      if (this.socket) {
        this.socket.emit('requestWeatherData', { lat, lon });
        this.socket.on('weatherData', (data) => {
          if (data) {
            this.updateWeatherUI(data);
            this.updateConnectionStatus('weather', true);
          }
        });
      }
    } catch (error) {
      console.error('Weather fetch failed:', error);
      this.loadMockWeatherData();
    }
  }

  loadMockWeatherData() {
    const mockData = {
      current: {
        temperature: 28,
        humidity: 65,
        pressure: 1013,
        windSpeed: 12,
        description: 'Partly cloudy'
      },
      forecast: [
        { time: new Date(), temp: 29, description: 'Sunny', precipitation: 0 },
        { time: new Date(Date.now() + 86400000), temp: 31, description: 'Cloudy', precipitation: 2 },
        { time: new Date(Date.now() + 172800000), temp: 27, description: 'Rain', precipitation: 15 },
        { time: new Date(Date.now() + 259200000), temp: 26, description: 'Thunderstorm', precipitation: 25 },
        { time: new Date(Date.now() + 345600000), temp: 30, description: 'Clear', precipitation: 0 }
      ]
    };
    this.updateWeatherUI(mockData);
  }

  updateWeatherUI(data) {
    if (!data || !data.current) return;

    const { current, forecast } = data;
    
    // Update current weather
    document.querySelector('.temp-display').textContent = `${Math.round(current.temperature)}°C`;
    document.querySelector('.weather-desc').textContent = current.description;
    document.getElementById('humidity').textContent = `${current.humidity}%`;
    document.getElementById('windSpeed').textContent = `${current.windSpeed} km/h`;
    document.getElementById('pressure').textContent = `${current.pressure} hPa`;
    document.getElementById('uvIndex').textContent = current.uvIndex || 'N/A';

    // Update forecast
    if (forecast && forecast.length > 0) {
      const forecastHTML = forecast.map(day => `
        <div class="forecast-item">
          <div>${new Date(day.time).toLocaleDateString('en', { weekday: 'short' })}</div>
          <div style="font-weight: 600;">${Math.round(day.temp)}°C</div>
          <div style="font-size: 0.8rem;">${day.description}</div>
          <div style="color: #3b82f6;">${day.precipitation}mm</div>
        </div>
      `).join('');
      
      document.getElementById('weatherForecast').innerHTML = forecastHTML;
    }

    this.sensorData.weather = current;
  }

  // IoT Data Handling
  handleIoTUpdate(data) {
    console.log('📊 IoT Data Update:', data);
    
    // Update sensor data
    if (data.weather) this.updateWeatherSensors(data.weather);
    if (data.soil) this.updateSoilSensors(data.soil);
    if (data.crop) this.updateCropSensors(data.crop);
    if (data.market) this.updateMarketData(data.market);
    if (data.advice) this.updateAdvisory(data.advice);
    
    // Update statistics
    this.updateFarmStatistics();
    
    // Store data
    this.sensorData = { ...this.sensorData, ...data };
  }

  updateSoilSensors(soilData) {
    // Update moisture progress bar
    const moisturePercent = Math.min(100, soilData.moisture);
    document.getElementById('moistureBar').style.width = `${moisturePercent}%`;
    document.getElementById('moistureValue').textContent = `${moisturePercent}%`;
    
    // Update other soil parameters
    document.getElementById('phValue').textContent = soilData.ph;
    document.getElementById('soilTemp').textContent = `${soilData.temperature}°C`;
    
    // Update nutrient bars (NPK)
    if (soilData.nitrogen) {
      const nPercent = Math.min(100, (soilData.nitrogen / 150) * 100);
      document.getElementById('nitrogenBar').style.width = `${nPercent}%`;
      document.getElementById('nitrogenValue').textContent = soilData.nitrogen;
    }
    
    if (soilData.phosphorus) {
      const pPercent = Math.min(100, (soilData.phosphorus / 75) * 100);
      document.getElementById('phosphorusBar').style.width = `${pPercent}%`;
      document.getElementById('phosphorusValue').textContent = soilData.phosphorus;
    }
    
    if (soilData.potassium) {
      const kPercent = Math.min(100, (soilData.potassium / 300) * 100);
      document.getElementById('potassiumBar').style.width = `${kPercent}%`;
      document.getElementById('potassiumValue').textContent = soilData.potassium;
    }
    
    // Check for irrigation needs
    if (moisturePercent < 30) {
      this.triggerIrrigationAlert();
    }
  }

  updateMarketData(marketData) {
    if (!marketData || marketData.length === 0) return;
    
    const marketHTML = marketData.map(item => `
      <div class="market-item">
        <div class="market-crop">${item.crop}</div>
        <div class="market-price">₹${item.price}/qtl</div>
        <div class="market-change ${item.change >= 0 ? 'up' : 'down'}">
          ${item.change >= 0 ? '↗' : '↘'} ${Math.abs(item.change).toFixed(0)}
        </div>
      </div>
    `).join('');
    
    document.getElementById('marketPrices').innerHTML = marketHTML;
    
    // Update price chart
    this.updatePriceChart(marketData);
  }

  updateAdvisory(advice) {
    if (!advice || advice.length === 0) {
      document.getElementById('advisoryList').innerHTML = '<p>No specific advice at this time. All systems normal.</p>';
      return;
    }
    
    const advisoryHTML = advice.map(item => `
      <div class="advisory-item ${item.priority}">
        <div class="advisory-priority">${item.priority} Priority</div>
        <div class="advisory-message">${item.message}</div>
        ${item.action ? `<button class="control-btn" onclick="dashboard.executeAction('${item.action}')">${this.getActionLabel(item.action)}</button>` : ''}
      </div>
    `).join('');
    
    document.getElementById('advisoryList').innerHTML = advisoryHTML;
  }

  getActionLabel(action) {
    const labels = {
      'irrigate': '💧 Irrigate Now',
      'fertilize': '🌱 Apply Fertilizer',
      'spray': '🛡️ Spray Treatment',
      'sell': '💰 View Market'
    };
    return labels[action] || '⚡ Take Action';
  }

  executeAction(action) {
    switch (action) {
      case 'irrigate':
        this.controlDevice('irrigation', 'start');
        break;
      case 'fertilize':
        this.showFertilizerRecommendations();
        break;
      case 'spray':
        this.controlDevice('pestControl', 'spray');
        break;
      case 'sell':
        this.highlightMarketOpportunities();
        break;
    }
  }

  // Device Control
  controlDevice(device, action) {
    if (!this.socket || !this.isConnected) {
      this.showNotification('IoT system not connected', 'error');
      return;
    }
    
    const command = {
      deviceId: `farm_${device}`,
      command: { action, timestamp: new Date() }
    };
    
    this.socket.emit('deviceControl', command);
    
    this.showNotification(`${device} ${action} command sent`, 'success');
    this.logAction(`${device}_${action}`, `${action} command sent to ${device}`);
  }

  toggleAutoIrrigation(enabled) {
    const status = enabled ? 'enabled' : 'disabled';
    this.showNotification(`Auto irrigation ${status}`, 'info');
    
    if (enabled) {
      document.getElementById('nextIrrigationTime').textContent = 'Auto mode: Based on soil moisture';
    } else {
      document.getElementById('nextIrrigationTime').textContent = 'Manual mode: Control irrigation manually';
    }
  }

  // Alert Management
  handleNewAlert(alert) {
    this.alerts.unshift(alert);
    this.updateAlertCount();
    this.displayAlert(alert);
    
    // Auto-acknowledge low priority alerts after 30 seconds
    if (alert.severity === 'low') {
      setTimeout(() => {
        this.acknowledgeAlert(alert.id);
      }, 30000);
    }
  }

  updateAlertCount() {
    const unacknowledged = this.alerts.filter(alert => !alert.acknowledged).length;
    document.getElementById('alertCount').textContent = unacknowledged;
    document.getElementById('alertStatus').textContent = unacknowledged;
  }

  displayAlert(alert) {
    const alertElement = document.createElement('div');
    alertElement.className = `alert-item ${alert.severity}`;
    alertElement.innerHTML = `
      <div class="alert-time">${new Date(alert.timestamp).toLocaleTimeString()}</div>
      <div class="alert-message">${alert.message}</div>
      <div class="alert-type">${alert.type.toUpperCase()}</div>
    `;
    
    const alertList = document.getElementById('alertList');
    if (alertList.children.length === 1 && alertList.children[0].tagName === 'P') {
      alertList.innerHTML = '';
    }
    alertList.prepend(alertElement);
  }

  toggleAlertPanel() {
    const panel = document.getElementById('alertPanel');
    panel.classList.toggle('hidden');
  }

  // Image Analysis for Crop Disease Detection
  async analyzeCropImage(file) {
    const resultsDiv = document.getElementById('analysisResults');
    resultsDiv.innerHTML = '<p>🔍 Analyzing crop image...</p>';
    
    try {
      const formData = new FormData();
      formData.append('image', file);
      
      const response = await fetch('http://localhost:4000/api/analyze-crop', {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) throw new Error('Analysis failed');
      
      const result = await response.json();
      
      resultsDiv.innerHTML = `
        <div class="analysis-result">
          <h4>🔬 Analysis Result</h4>
          <div class="result-item">
            <strong>Condition:</strong> ${result.analysis.disease}
          </div>
          <div class="result-item">
            <strong>Confidence:</strong> ${(result.analysis.confidence * 100).toFixed(1)}%
          </div>
          <div class="result-item">
            <strong>Recommendation:</strong> ${result.analysis.treatment}
          </div>
          <div class="result-timestamp">
            Analyzed: ${new Date(result.timestamp).toLocaleString()}
          </div>
        </div>
      `;
      
    } catch (error) {
      console.error('Image analysis failed:', error);
      resultsDiv.innerHTML = '<p>❌ Analysis failed. Please try again.</p>';
    }
  }

  // Camera Capture Setup
  setupCameraCapture() {
    const cameraBtn = document.getElementById('cameraBtn');
    const captureBtn = document.getElementById('captureBtn');
    const video = document.getElementById('cameraFeed');
    const canvas = document.getElementById('captureCanvas');
    
    let stream = null;
    
    cameraBtn.addEventListener('click', async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'environment' } // Use back camera on mobile
        });
        
        video.srcObject = stream;
        video.style.display = 'block';
        captureBtn.style.display = 'inline-block';
        cameraBtn.textContent = '📹 Stop Camera';
        
        video.play();
        
      } catch (error) {
        console.error('Camera access failed:', error);
        this.showNotification('Camera access denied', 'error');
      }
    });
    
    captureBtn.addEventListener('click', () => {
      const context = canvas.getContext('2d');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      canvas.toBlob((blob) => {
        this.analyzeCropImage(blob);
      }, 'image/jpeg', 0.8);
      
      // Stop camera
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        video.style.display = 'none';
        captureBtn.style.display = 'none';
        cameraBtn.textContent = '📹 Use Camera';
      }
    });
  }

  // Voice Assistant
  setupVoiceAssistant() {
    this.speechRecognition = null;
    this.speechSynthesis = window.speechSynthesis;
    
    if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      this.speechRecognition = new SpeechRecognition();
      this.speechRecognition.continuous = false;
      this.speechRecognition.interimResults = false;
      this.speechRecognition.lang = this.currentLanguage === 'hi' ? 'hi-IN' : 'en-IN';
    }
  }

  startVoiceInteraction() {
    if (!this.speechRecognition) {
      this.showNotification('Voice recognition not supported', 'error');
      return;
    }
    
    const voiceBtn = document.getElementById('voiceBtn');
    const voiceStatus = document.getElementById('voiceStatus');
    const voiceOutput = document.getElementById('voiceOutput');
    
    voiceBtn.classList.add('listening');
    voiceStatus.textContent = 'Listening...';
    
    this.speechRecognition.start();
    
    this.speechRecognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      voiceOutput.innerHTML += `<div><strong>You:</strong> ${transcript}</div>`;
      
      // Process voice command
      this.processVoiceCommand(transcript);
      
      voiceBtn.classList.remove('listening');
      voiceStatus.textContent = 'Processing...';
    };
    
    this.speechRecognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      voiceBtn.classList.remove('listening');
      voiceStatus.textContent = 'Voice recognition failed';
    };
    
    this.speechRecognition.onend = () => {
      voiceBtn.classList.remove('listening');
      if (voiceStatus.textContent === 'Listening...') {
        voiceStatus.textContent = 'Ready to listen';
      }
    };
  }

  processVoiceCommand(command) {
    const lowerCommand = command.toLowerCase();
    let response = '';
    
    if (lowerCommand.includes('weather')) {
      const temp = this.sensorData.weather.temperature || 'unknown';
      response = `Current temperature is ${temp} degrees celsius`;
    } else if (lowerCommand.includes('soil') || lowerCommand.includes('moisture')) {
      const moisture = this.sensorData.soil?.moisture || 'unknown';
      response = `Soil moisture level is ${moisture} percent`;
    } else if (lowerCommand.includes('irrigation') || lowerCommand.includes('water')) {
      this.controlDevice('irrigation', 'start');
      response = 'Starting irrigation system';
    } else if (lowerCommand.includes('market') || lowerCommand.includes('price')) {
      response = 'Checking latest market prices for you';
      this.highlightMarketOpportunities();
    } else {
      response = 'I understand you said: ' + command + '. How can I help you with your farm?';
    }
    
    // Add response to output
    document.getElementById('voiceOutput').innerHTML += `<div><strong>AGRINOVA:</strong> ${response}</div>`;
    
    // Speak response
    if (this.speechSynthesis) {
      const utterance = new SpeechSynthesisUtterance(response);
      utterance.lang = this.currentLanguage === 'hi' ? 'hi-IN' : 'en-IN';
      this.speechSynthesis.speak(utterance);
    }
    
    document.getElementById('voiceStatus').textContent = 'Ready to listen';
  }

  // Chart Management
  initializePriceChart() {
    const ctx = document.getElementById('priceChart').getContext('2d');
    
    this.priceChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        datasets: [{
          label: 'Wheat Price',
          data: [2100, 2120, 2090, 2150, 2140],
          borderColor: '#2b9348',
          backgroundColor: 'rgba(43, 147, 72, 0.1)',
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: false,
            ticks: {
              callback: function(value) {
                return '₹' + value;
              }
            }
          }
        },
        plugins: {
          legend: {
            display: false
          }
        }
      }
    });
  }

  updatePriceChart(marketData) {
    if (!this.priceChart || !marketData.length) return;
    
    // Use wheat data for chart
    const wheatData = marketData.find(item => item.crop === 'Wheat');
    if (wheatData) {
      // Simulate price history
      const currentPrice = wheatData.price;
      const priceHistory = [
        currentPrice - 50,
        currentPrice - 30,
        currentPrice - 10,
        currentPrice + 20,
        currentPrice
      ];
      
      this.priceChart.data.datasets[0].data = priceHistory;
      this.priceChart.update();
    }
  }

  // Utility Functions
  updateConnectionStatus(service, status) {
    const statusElement = document.getElementById(`${service}Status`);
    if (statusElement) {
      statusElement.className = `status-dot ${status ? 'online' : 'offline'}`;
    }
  }

  updateFarmStatistics() {
    // Update mock statistics - replace with real calculations
    document.getElementById('dailyWaterUsage').textContent = `${Math.floor(Math.random() * 500) + 200} L`;
    document.getElementById('monthlyYield').textContent = `${Math.floor(Math.random() * 200) + 800} kg`;
    document.getElementById('efficiency').textContent = `${Math.floor(Math.random() * 20) + 75}%`;
  }

  triggerIrrigationAlert() {
    const alert = {
      type: 'irrigation',
      message: 'Low soil moisture detected. Irrigation recommended.',
      severity: 'medium',
      timestamp: new Date()
    };
    this.handleNewAlert(alert);
  }

  showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 100px;
      right: 20px;
      background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      z-index: 10000;
      transform: translateX(400px);
      transition: transform 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
      notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Remove after 3 seconds
    setTimeout(() => {
      notification.style.transform = 'translateX(400px)';
      setTimeout(() => {
        document.body.removeChild(notification);
      }, 300);
    }, 3000);
  }

  logAction(action, description) {
    const logItem = document.createElement('div');
    logItem.className = 'log-item';
    logItem.innerHTML = `
      <span>${description}</span>
      <small>${new Date().toLocaleTimeString()}</small>
    `;
    
    const logList = document.getElementById('irrigationLog');
    logList.prepend(logItem);
    
    // Keep only last 5 items
    while (logList.children.length > 5) {
      logList.removeChild(logList.lastChild);
    }
  }

  changeLanguage(lang) {
    this.currentLanguage = lang;
    
    // Update speech recognition language
    if (this.speechRecognition) {
      this.speechRecognition.lang = lang === 'hi' ? 'hi-IN' : 'en-IN';
    }
    
    // Update UI text based on language
    const welcomeText = document.getElementById('welcomeText');
    const translations = {
      'en': '🌾 AGRINOVA Pro',
      'hi': '🌾 एग्रीनोवा प्रो',
      'te': '🌾 అగ్రీనోవా ప్రో',
      'ta': '🌾 அக்ரினோவா ப்ரோ'
    };
    
    welcomeText.textContent = translations[lang] || translations['en'];
    
    this.showNotification(`Language changed to ${lang.toUpperCase()}`, 'info');
  }

  highlightMarketOpportunities() {
    // Highlight profitable crops in market section
    const marketItems = document.querySelectorAll('.market-item');
    marketItems.forEach(item => {
      const changeElement = item.querySelector('.market-change');
      if (changeElement.classList.contains('up')) {
        item.style.background = 'rgba(16, 185, 129, 0.1)';
        item.style.border = '2px solid #10b981';
      }
    });
    
    setTimeout(() => {
      marketItems.forEach(item => {
        item.style.background = '';
        item.style.border = '';
      });
    }, 5000);
  }

  showFertilizerRecommendations() {
    const advisory = document.getElementById('advisoryList');
    const recommendation = document.createElement('div');
    recommendation.className = 'advisory-item medium';
    recommendation.innerHTML = `
      <div class="advisory-priority">FERTILIZER RECOMMENDATION</div>
      <div class="advisory-message">
        Based on current soil analysis:<br>
        • Nitrogen: Apply 20kg/hectare<br>
        • Phosphorus: Adequate levels<br>
        • Potassium: Apply 15kg/hectare<br>
        Best application time: Early morning or evening
      </div>
    `;
    advisory.prepend(recommendation);
  }

  startBackgroundUpdates() {
    // Update timestamps every minute
    setInterval(() => {
      this.updateTimestamps();
    }, 60000);
    
    // Refresh statistics every 5 minutes
    setInterval(() => {
      this.updateFarmStatistics();
    }, 300000);
    
    // Check for maintenance alerts every hour
    setInterval(() => {
      this.checkMaintenanceAlerts();
    }, 3600000);
  }

  updateTimestamps() {
    // Update relative timestamps in the UI
    const timeElements = document.querySelectorAll('.timestamp');
    timeElements.forEach(element => {
      const time = new Date(element.dataset.time);
      element.textContent = this.getRelativeTime(time);
    });
  }

  getRelativeTime(date) {
    const now = new Date();
    const diffInMinutes = Math.floor((now - date) / 60000);
    
    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`;
    return `${Math.floor(diffInMinutes / 1440)}d ago`;
  }

  checkMaintenanceAlerts() {
    // Check if any systems need maintenance
    const systems = ['irrigation', 'fertilizer', 'sensors'];
    
    systems.forEach(system => {
      if (Math.random() > 0.9) { // 10% chance per hour
        const alert = {
          type: 'maintenance',
          message: `${system} system requires maintenance check`,
          severity: 'low',
          timestamp: new Date()
        };
        this.handleNewAlert(alert);
      }
    });
  }
}

// Initialize Dashboard
const dashboard = new AGRINOVADashboard();

// Export for global access
window.dashboard = dashboard;
