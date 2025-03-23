// File structure:
// - main.js (Electron main process)
// - index.html (Main application window)
// - renderer.js (Frontend logic)
// - jiraService.js (Jira API integration)
// - package.json (Project configuration)

// main.js - Main Electron process
const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, dialog, net } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');

// Make fetch available in the browser context for compatibility
app.commandLine.appendSwitch('enable-features', 'FetchAPI');

// Create a store for persistent data
const store = new Store({
  name: 'jira-logger-credentials',
  encryptionKey: 'your-encryption-key-for-jira-logger-app' // For better security of saved credentials
});

let mainWindow;
let tray;
let isQuitting = false;
let currentTrackingData = null;
let reminderIntervalId = null;

// Initialize the app
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: path.join(__dirname, 'assets/icon.png'),
    show: false, // Don't show on start
    title: "Jira Logger",
    alwaysOnTop: false, // Start not on top but we'll change this for reminders
    skipTaskbar: false, // Always show in taskbar
    focusable: true, // Ensure the window can be focused
    minimizable: true,
    maximizable: true,
    center: true // Center window on screen
  });

  mainWindow.loadFile('index.html');

  // Hide window to tray when closed
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
  });

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    // Check for startup launch
    if (!store.get('minimizeOnStartup', false)) {
      mainWindow.show();
      mainWindow.focus(); // Explicitly focus window when shown
    } else {
      // Show a notification that the app is running in the background
      new Notification({
        title: 'Jira Logger',
        body: 'App is running in the background. Click the tray icon to open.',
        icon: path.join(__dirname, 'assets/icon.png')
      }).show();
    }
  });

  // Create tray icon
  createTray();
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'assets/tray-icon.png'));
  
  updateTrayMenu();
  
  // Show window on double click
  tray.on('double-click', () => {
    mainWindow.show();
  });
}

function updateTrayMenu() {
  const trackingMenuItems = currentTrackingData ? [
    { 
      label: `Currently tracking: ${currentTrackingData.issueKey}`, 
      enabled: false 
    },
    { 
      label: 'Log Work Now', 
      click: () => { 
        mainWindow.show();
        mainWindow.webContents.send('show-log-work'); 
      } 
    },
    { 
      label: 'Stop Tracking', 
      click: () => { 
        mainWindow.webContents.send('stop-tracking');
      } 
    },
    { type: 'separator' }
  ] : [];

  const contextMenu = Menu.buildFromTemplate([
    ...trackingMenuItems,
    { 
      label: 'Show App', 
      click: () => { mainWindow.show(); } 
    },
    { 
      label: 'Start New Task', 
      click: () => { 
        mainWindow.show();
        mainWindow.webContents.send('start-new-task');
      } 
    },
    { type: 'separator' },
    {
      label: 'Preferences',
      submenu: [
        {
          label: 'Start Minimized',
          type: 'checkbox',
          checked: store.get('minimizeOnStartup', false),
          click: (menuItem) => {
            store.set('minimizeOnStartup', menuItem.checked);
          }
        },
        {
          label: 'Launch on Startup',
          type: 'checkbox',
          checked: app.getLoginItemSettings().openAtLogin,
          click: (menuItem) => {
            app.setLoginItemSettings({
              openAtLogin: menuItem.checked
            });
          }
        },
        {
          label: 'Clear Saved API Token',
          click: () => {
            const credentials = store.get('jira-credentials');
            if (credentials) {
              // Keep the URL and username, but clear the token
              store.set('jira-credentials', {
                baseUrl: credentials.baseUrl,
                username: credentials.username,
                apiToken: ''
              });
              
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'API Token Cleared',
                message: 'Your saved API token has been cleared. You will need to enter it again next time.'
              });
            }
          }
        }
      ]
    },
    { type: 'separator' },
    { 
      label: 'Quit', 
      click: () => {
        if (currentTrackingData) {
          const choice = dialog.showMessageBoxSync(mainWindow, {
            type: 'question',
            buttons: ['Quit without logging', 'Log work and quit', 'Cancel'],
            title: 'Jira Logger - Active Tracking',
            message: 'You have an active tracking session. What would you like to do?',
            defaultId: 1
          });
          
          if (choice === 2) {
            return; // Cancel was clicked
          } else if (choice === 1) {
            // Log work and quit
            mainWindow.webContents.send('quit-and-log-work');
            return;
          }
          // Otherwise, proceed to quit
        }
        
        isQuitting = true;
        app.quit();
      } 
    }
  ]);
  
  tray.setToolTip(currentTrackingData 
    ? `Jira Logger - Tracking ${currentTrackingData.issueKey}`
    : 'Jira Logger - Idle');
  tray.setContextMenu(contextMenu);
}

// For Windows, try to use SetForegroundWindow API
function forceFocusWindows() {
  if (process.platform === 'win32') {
    try {
      console.log('Using Windows-specific approach to focus window (not implemented)');
      // Simple implementation that doesn't require external modules
      return false;
    } catch (error) {
      console.error('Error using Windows API for focus:', error);
    }
  }
  return false;
}

// Check for Windows foreground permissions
function checkWindowsPermissions() {
  // Simplified version that does nothing
  return;
}

// Configure Windows registry for foreground activation (Windows 10/11)
function configureWindowsForForegroundActivation() {
  // Simplified version that does nothing
  return;
}

// Schedule reminders based on user settings
function scheduleReminder(minutes) {
  // Clear any existing reminder
  clearReminder();
  
  if (!minutes || minutes < 1) {
    return; // Don't schedule if invalid
  }
  
  reminderIntervalId = setInterval(() => {
    // Show reminder using a simplified approach
    showReminder("Jira Logger Reminder", "Time to update your Jira task! Click to add comments and log work.");
    
    // Send message to renderer
    if (mainWindow) {
      mainWindow.webContents.send('time-reminder');
    }
  }, minutes * 60 * 1000);
}

function showReminder(title, message) {
  if (mainWindow) {
    // Show window if not visible
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    
    // Restore if minimized
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    
    // Focus the window
    mainWindow.focus();
    
    // Flash taskbar icon on Windows
    if (process.platform === 'win32') {
      mainWindow.flashFrame(true);
    }
    
    // Stop flashing the taskbar icon after a short delay
    setTimeout(() => {
      if (process.platform === 'win32') {
        mainWindow.flashFrame(false);
      }
    }, 5000); // Flash for 5 seconds
  }
  
  // Show notification
  const notification = new Notification({
    title: title,
    body: message,
    icon: path.join(__dirname, 'assets/icon.png'),
    urgency: 'critical'
  });
  
  notification.show();
  
  // Handle notification click
  notification.on('click', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
      mainWindow.webContents.send('show-log-work');
    }
  });
}

function clearReminder() {
  if (reminderIntervalId) {
    clearInterval(reminderIntervalId);
    reminderIntervalId = null;
  }
}

// Electron app events
app.whenReady().then(() => {
  createWindow();
  
  // Check for updates
  autoUpdater.checkForUpdatesAndNotify();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  
  // Listen for IPC messages from renderer
  ipcMain.on('set-reminder', (event, minutes) => {
    scheduleReminder(minutes);
  });
  
  ipcMain.on('flash-window', (event, start) => {
    if (mainWindow) {
      if (start) {
        mainWindow.flashFrame(true); // Start flashing
      } else {
        mainWindow.flashFrame(false); // Stop flashing
      }
    }
  });
  
  ipcMain.on('check-window-status', (event) => {
    try {
      if (!mainWindow) {
        event.reply('window-status', { error: 'No main window found' });
        return;
      }
      
      const status = {
        isVisible: mainWindow.isVisible(),
        isMinimized: mainWindow.isMinimized(),
        isFocused: mainWindow.isFocused(),
        isAlwaysOnTop: mainWindow.isAlwaysOnTop(),
        bounds: mainWindow.getBounds(),
        platform: process.platform
      };
      
      event.reply('window-status', status);
      
      // Simple test to bring window to front
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      
      mainWindow.setAlwaysOnTop(true);
      mainWindow.moveTop();
      mainWindow.focus();
      
      setTimeout(() => {
        mainWindow.setAlwaysOnTop(false);
      }, 3000);
      
    } catch (error) {
      event.reply('window-status', { error: error.message });
    }
  });
  
  ipcMain.on('save-credentials', (event, credentials) => {
    // Always save the credentials as they are passed in - including empty tokens if requested
    console.log('Saving credentials with token length:', credentials.apiToken ? credentials.apiToken.length : 0);
    store.set('jira-credentials', credentials);
    event.reply('credentials-saved', true);
  });
  
  ipcMain.on('get-credentials', (event) => {
    const credentials = store.get('jira-credentials');
    console.log('Retrieved credentials:', credentials ? 
      `URL: ${credentials.baseUrl}, Username: ${credentials.username}, Token exists: ${Boolean(credentials.apiToken)}` :
      'No credentials found');
    event.reply('credentials-loaded', credentials || {});
  });
  
  ipcMain.on('start-tracking', (event, trackingData) => {
    currentTrackingData = trackingData;
    updateTrayMenu();
  });
  
  ipcMain.on('stop-tracking', () => {
    currentTrackingData = null;
    clearReminder();
    updateTrayMenu();
  });
  
  ipcMain.on('log-work-submitted', () => {
    new Notification({
      title: 'Jira Logger',
      body: 'Work has been logged successfully!',
      icon: path.join(__dirname, 'assets/icon.png')
    }).show();
  });
  
  ipcMain.on('log-work-and-quit', () => {
    isQuitting = true;
    setTimeout(() => app.quit(), 1000); // Give time for work logging to complete
  });
  
  ipcMain.on('get-app-settings', (event) => {
    event.reply('app-settings', {
      minimizeOnStartup: store.get('minimizeOnStartup', false),
      launchOnStartup: app.getLoginItemSettings().openAtLogin
    });
  });
  
  ipcMain.on('set-app-settings', (event, settings) => {
    if (settings.minimizeOnStartup !== undefined) {
      store.set('minimizeOnStartup', settings.minimizeOnStartup);
    }
    
    if (settings.launchOnStartup !== undefined) {
      app.setLoginItemSettings({
        openAtLogin: settings.launchOnStartup
      });
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
});