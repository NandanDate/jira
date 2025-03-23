// renderer.js - Handles UI interactions
const { ipcRenderer } = require('electron');
const JiraService = require('./jiraService.js');

// DOM Elements
const loginSection = document.getElementById('login-section');
const projectSection = document.getElementById('project-section');
const trackingSection = document.getElementById('tracking-section');
const logWorkSection = document.getElementById('log-work-section');

// Form elements
const loginForm = document.getElementById('login-form');
const projectSelect = document.getElementById('project-select');
const issueSelect = document.getElementById('issue-select');
const newIssueButton = document.getElementById('new-issue-button');
const newIssueForm = document.getElementById('new-issue-form');
const createIssueButton = document.getElementById('create-issue-button');
const cancelIssueButton = document.getElementById('cancel-issue-button');
const reminderHoursInput = document.getElementById('reminder-hours');
const reminderMinutesInput = document.getElementById('reminder-minutes');
const startTrackingButton = document.getElementById('start-tracking-button');
const logWorkButton = document.getElementById('log-work-button');
const stopTrackingButton = document.getElementById('stop-tracking-button');
const timeSpentInput = document.getElementById('time-spent');
const workCommentInput = document.getElementById('work-comment');
const submitLogButton = document.getElementById('submit-log-button');
const cancelLogButton = document.getElementById('cancel-log-button');
const useCurrentTimeBtn = document.getElementById('use-current-time');
const rememberTokenCheckbox = document.getElementById('remember-token');
const loginStatusDiv = document.getElementById('login-status');
const apiTokenInput = document.getElementById('api-token');

// Display elements
const currentProjectSpan = document.getElementById('current-project');
const currentIssueSpan = document.getElementById('current-issue');
const startTimeSpan = document.getElementById('start-time');
const elapsedTimeSpan = document.getElementById('elapsed-time');

// Global variables
let jiraService = null;
let currentIssue = null;
let startTime = null;
let timerInterval = null;
let autoLogOnQuit = false;

// Initialize the app
function init() {
  console.log('Initializing app, checking for saved credentials');
  
  // Try to load saved values first
  const savedDomain = localStorage.getItem('jira-domain');
  const savedEmail = localStorage.getItem('jira-email');
  const savedToken = localStorage.getItem('jira-token');
  
  console.log('LocalStorage contains:', {
    domain: savedDomain ? 'exists' : 'missing',
    email: savedEmail ? 'exists' : 'missing',
    token: savedToken ? 'exists' : 'missing'
  });
  
  if (savedDomain) {
    document.getElementById('jira-url').value = savedDomain;
  }
  
  if (savedEmail) {
    document.getElementById('username').value = savedEmail;
  }
  
  if (savedToken) {
    document.getElementById('api-token').value = savedToken;
  }

  // Add event listener for API token field focus
  if (apiTokenInput) {
    apiTokenInput.addEventListener('focus', showApiTokenHelp);
  }

  // Add event listener for the Get API Token button
  const getTokenButton = document.getElementById('get-token-button');
  if (getTokenButton) {
    getTokenButton.addEventListener('click', () => {
      window.open('https://id.atlassian.com/manage-profile/security/api-tokens', '_blank');
    });
  }

  // Add event listener for the direct token link
  const directTokenLink = document.getElementById('direct-token-link');
  if (directTokenLink) {
    directTokenLink.addEventListener('click', (e) => {
      e.preventDefault();
      window.open('https://id.atlassian.com/manage-profile/security/api-tokens', '_blank');
    });
  }

  // Load saved credentials from electron-store
  ipcRenderer.send('get-credentials');
  
  // Listen for IPC messages
  ipcRenderer.on('credentials-loaded', (event, credentials) => {
    console.log('Received credentials from main process');
    
    // Get token from localStorage as a fallback
    const savedToken = localStorage.getItem('jira-token');
    console.log('Token in localStorage:', savedToken ? 'exists' : 'missing');
    
    // Check if we have credentials from electron-store
    if (credentials && credentials.baseUrl) {
      console.log('Using credentials from electron-store');
      
      // Set URL and username values
      document.getElementById('jira-url').value = credentials.baseUrl;
      document.getElementById('username').value = credentials.username;
      
      // Prioritize token from localStorage if it exists (for backward compatibility)
      let tokenToUse = '';
      if (savedToken) {
        console.log('Using token from localStorage');
        tokenToUse = savedToken;
      } else if (credentials.apiToken && credentials.apiToken.trim() !== '') {
        console.log('Using token from electron-store');
        tokenToUse = credentials.apiToken;
      }
      
      // Only auto-login if we have a token from either source
      if (tokenToUse) {
        document.getElementById('api-token').value = tokenToUse;
        
        // Show login status
        updateLoginStatus('Auto-connecting with saved credentials...', 'loading');
        
        // Create merged credentials
        const mergedCredentials = {
          baseUrl: credentials.baseUrl,
          username: credentials.username,
          apiToken: tokenToUse
        };
        
        // Try to auto-login
        authenticateJira(mergedCredentials, true);
      } else {
        // We have saved URL and username but no token
        updateLoginStatus('Please enter your API token to connect', null);
        document.getElementById('remember-token').checked = true;
      }
    } else if (savedToken) {
      // If we have a token in localStorage but not in electron-store
      console.log('No credentials in electron-store, but found token in localStorage');
      if (document.getElementById('jira-url').value && document.getElementById('username').value) {
        document.getElementById('api-token').value = savedToken;
      }
    }
  });
  
  ipcRenderer.on('time-reminder', () => {
    console.log('Reminder triggered - displaying reminder dialog');
    
    // Play audio alert to get attention
    const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBhxQo/T/xHErCgogZbX94sN3MRIFKHCy8tm6dDMUBzRyruPOr201EglBdarbwKVqNRQQS32i0LSdZjgYFlJ7mMWolGE8HB5TcJLAn5FfQCEfUTyaw5OJX0MkHlMo0LyIiFxEJxhT');
    audio.volume = 1.0;
    audio.play().catch(err => console.log('Error playing sound:', err));
    
    // Request window to flash in taskbar
    ipcRenderer.send('flash-window', true);
    
    // Create the reminder dialog
    const reminderDialog = document.createElement('div');
    reminderDialog.classList.add('reminder-dialog');
    reminderDialog.innerHTML = `
      <div class="reminder-content">
        <div class="pulse-animation">
          <h2 class="blinking">TIME TO LOG YOUR WORK!</h2>
        </div>
        <p class="reminder-message">Your tracking reminder has elapsed. Please update your time log now!</p>
        <div class="reminder-buttons">
          <button id="reminder-log-now" class="primary-button">Log Work Now</button>
          <button id="reminder-later" class="secondary-button">Remind Me Later</button>
          <button id="reminder-snooze" class="small-button">Snooze 5 minutes</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(reminderDialog);
    
    // Handle reminder dialog buttons
    document.getElementById('reminder-log-now').addEventListener('click', () => {
      document.body.removeChild(reminderDialog);
      ipcRenderer.send('flash-window', false); // Stop window flashing
      showLogWorkSection();
    });
    
    document.getElementById('reminder-later').addEventListener('click', () => {
      document.body.removeChild(reminderDialog);
      ipcRenderer.send('flash-window', false); // Stop window flashing
    });
    
    document.getElementById('reminder-snooze').addEventListener('click', () => {
      document.body.removeChild(reminderDialog);
      ipcRenderer.send('flash-window', false); // Stop window flashing
      // Snooze the reminder for 5 minutes
      ipcRenderer.send('set-reminder', 5);
    });
    
    // Auto-remove the dialog after 60 seconds if no action is taken
    setTimeout(() => {
      if (document.body.contains(reminderDialog)) {
        document.body.removeChild(reminderDialog);
        ipcRenderer.send('flash-window', false); // Stop window flashing
      }
    }, 60000);
  });
  
  ipcRenderer.on('start-new-task', () => {
    resetTracking();
    showProjectSection();
  });

  ipcRenderer.on('show-log-work', () => {
    showLogWorkSection();
  });
  
  ipcRenderer.on('stop-tracking', () => {
    stopTracking();
    resetTracking();
    showProjectSection();
  });
  
  ipcRenderer.on('quit-and-log-work', async () => {
    autoLogOnQuit = true;
    showLogWorkSection();
  });
  
  // Setup event listeners
  setupEventListeners();
}

// Update login status message
function updateLoginStatus(message, type = null) {
  if (!loginStatusDiv) return;
  
  // Check if the message is about authentication error
  if (type === 'error' && (message.includes('Authentication') || message.includes('Invalid credentials'))) {
    // Add helpful API token hint
    loginStatusDiv.innerHTML = `${message}<br><small style="display: block; margin-top: 8px;">
      Make sure your API token is correct. Tokens can be created at 
      <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" class="api-token-link">
        Atlassian Account Settings</a>
    </small>`;
  } else {
    loginStatusDiv.textContent = message;
  }
  
  // Clear existing classes
  loginStatusDiv.classList.remove('error', 'success', 'loading');
  
  if (type) {
    loginStatusDiv.classList.add(type);
  } else {
    loginStatusDiv.style.display = 'none';
  }
}

// Set up all event listeners
function setupEventListeners() {
  // Login form submission
  loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    
    // Show loading status
    updateLoginStatus('Connecting to Jira...', 'loading');
    
    // Disable login button during authentication
    document.getElementById('login-button').disabled = true;
    
    const credentials = {
      baseUrl: document.getElementById('jira-url').value.trim(),
      username: document.getElementById('username').value.trim(),
      apiToken: document.getElementById('api-token').value.trim()
    };
    
    // Get remember token preference
    const rememberToken = rememberTokenCheckbox.checked;
    
    authenticateJira(credentials, rememberToken);
  });
  
  // Project selection changes
  projectSelect.addEventListener('change', async () => {
    const projectKey = projectSelect.value;
    if (projectKey) {
      await loadIssuesForProject(projectKey);
    }
  });
  
  // New issue button
  newIssueButton.addEventListener('click', () => {
    newIssueForm.classList.remove('hidden');
  });
  
  // Create issue button
  createIssueButton.addEventListener('click', async () => {
    const projectKey = projectSelect.value;
    const summary = document.getElementById('issue-summary').value;
    const issueType = document.getElementById('issue-type').value;
    
    if (projectKey && summary) {
      try {
        // Show loading state
        createIssueButton.disabled = true;
        createIssueButton.textContent = 'Creating...';
        
        const issue = await jiraService.createIssue(projectKey, summary, issueType);
        
        // Reload issues
        await loadIssuesForProject(projectKey);
        
        // Select the new issue
        issueSelect.value = issue.key;
        
        // Hide the form
        newIssueForm.classList.add('hidden');
        
        // Clear the form
        document.getElementById('issue-summary').value = '';
        
        // Show success message
        const successMessage = document.createElement('div');
        successMessage.classList.add('success-message');
        successMessage.textContent = `Issue ${issue.key} created successfully!`;
        document.body.appendChild(successMessage);
        
        // Auto-remove success message after 3 seconds
        setTimeout(() => {
          if (document.body.contains(successMessage)) {
            document.body.removeChild(successMessage);
          }
        }, 3000);
      } catch (error) {
        alert(`Error creating issue: ${error.message}`);
      } finally {
        // Reset button state
        createIssueButton.disabled = false;
        createIssueButton.textContent = 'Create Issue';
      }
    } else {
      alert('Project and summary are required');
    }
  });
  
  // Cancel issue button
  cancelIssueButton.addEventListener('click', () => {
    newIssueForm.classList.add('hidden');
  });
  
  // Start tracking button
  startTrackingButton.addEventListener('click', () => {
    const projectKey = projectSelect.value;
    const issueKey = issueSelect.value;
    
    if (projectKey && issueKey) {
      startTracking(projectKey, issueKey);
    } else {
      alert('Please select both project and issue');
    }
  });
  
  // Log work button
  logWorkButton.addEventListener('click', () => {
    showLogWorkSection();
  });
  
  // Stop tracking button
  stopTrackingButton.addEventListener('click', () => {
    stopTracking();
    resetTracking();
    showProjectSection();
  });
  
  // Submit log button
  submitLogButton.addEventListener('click', async () => {
    const timeSpent = timeSpentInput.value.trim();
    const comment = workCommentInput.value;
    
    if (!timeSpent) {
      alert('Time spent is required');
      return;
    }
    
    if (!validateJiraTimeFormat(timeSpent)) {
      alert('Invalid time format. Please use Jira format like "1h 30m", "1.5h", or "45m".');
      return;
    }
    
    if (!comment || comment.trim() === '') {
      const useEmptyComment = confirm('You haven\'t entered a comment. Continue with an empty comment?');
      if (!useEmptyComment) {
        return;
      }
    }
    
    if (currentIssue) {
      try {
        // Show loading indicator
        submitLogButton.disabled = true;
        submitLogButton.textContent = 'Submitting...';
        
        // Log the work using the API v3 format
        const result = await jiraService.logWork(currentIssue, timeSpent, comment || 'Time logged via Jira Logger');
        console.log('Work log result:', result);
        
        // Show success message
        const successMessage = document.createElement('div');
        successMessage.classList.add('success-message');
        successMessage.textContent = `Work logged successfully: ${timeSpent} on ${currentIssue}`;
        document.body.appendChild(successMessage);
        
        // Auto-remove success message after 3 seconds
        setTimeout(() => {
          if (document.body.contains(successMessage)) {
            document.body.removeChild(successMessage);
          }
        }, 3000);
        
        // Notify main process that work was logged
        ipcRenderer.send('log-work-submitted');
        
        // Check if we're logging on quit
        if (autoLogOnQuit) {
          autoLogOnQuit = false;
          ipcRenderer.send('log-work-and-quit');
          return;
        }
        
        // If still tracking, continue tracking
        if (startTime) {
          showTrackingSection();
        } else {
          resetTracking();
          showProjectSection();
        }
        
        // Clear form
        timeSpentInput.value = '';
        workCommentInput.value = '';
      } catch (error) {
        console.error('Error while logging work:', error);
        
        // Create a more user-friendly error dialog
        const errorMessage = document.createElement('div');
        errorMessage.classList.add('error-message');
        
        // Main error message
        const mainError = document.createElement('p');
        mainError.textContent = error.message || 'Failed to log work in Jira';
        errorMessage.appendChild(mainError);
        
        // If we have a status code, add that info
        if (error.status) {
          const statusInfo = document.createElement('p');
          statusInfo.textContent = `Status code: ${error.status}`;
          errorMessage.appendChild(statusInfo);
        }
        
        // Add troubleshooting tips
        const troubleshooting = document.createElement('ul');
        troubleshooting.innerHTML = `
          <li>Check your Jira permissions - you need "Work On Issues" permission</li>
          <li>Verify your API token is valid and hasn't expired</li>
          <li>Make sure the issue still exists and is accessible to you</li>
          <li>Check that your time format is valid (e.g., "1h 30m", "1.5h", or "45m")</li>
        `;
        errorMessage.appendChild(troubleshooting);
        
        // Show custom error dialog
        const dialog = document.createElement('div');
        dialog.classList.add('error-dialog');
        dialog.appendChild(errorMessage);
        
        const closeButton = document.createElement('button');
        closeButton.textContent = 'Close';
        closeButton.addEventListener('click', () => {
          document.body.removeChild(dialog);
        });
        
        dialog.appendChild(closeButton);
        document.body.appendChild(dialog);
      } finally {
        // Reset button state
        submitLogButton.disabled = false;
        submitLogButton.textContent = 'Submit';
      }
    } else {
      alert('No issue selected for logging work');
    }
  });
  
  // Cancel log button
  cancelLogButton.addEventListener('click', () => {
    // Check if we're logging on quit
    if (autoLogOnQuit) {
      autoLogOnQuit = false;
      ipcRenderer.send('log-work-and-quit');
      return;
    }
    
    // If still tracking, continue tracking
    if (startTime) {
      showTrackingSection();
    } else {
      showProjectSection();
    }
  });
  
  // Add event listener for Use Current Time button
  if (useCurrentTimeBtn) {
    useCurrentTimeBtn.addEventListener('click', () => {
      if (!startTime) return;
      
      const now = new Date();
      const elapsed = Math.floor((now - startTime) / 1000);
      const totalMinutes = Math.round(elapsed / 60);
      const displayHours = Math.floor(totalMinutes / 60);
      const displayMinutes = totalMinutes % 60;
      
      // Format in Jira's expected format
      let timeValue = '';
      if (displayHours > 0) {
        timeValue += `${displayHours}h`;
        if (displayMinutes > 0) {
          timeValue += ' ';
        }
      }
      if (displayMinutes > 0 || displayHours === 0) {
        timeValue += `${displayMinutes}m`;
      }
      
      // Update both display formats
      timeSpentInput.value = timeValue.trim();
    });
  }
}

// Authenticate with Jira
async function authenticateJira(credentials, rememberToken = true) {
  try {
    console.log('Authenticating with Jira, remember token:', rememberToken);
    jiraService = new JiraService(credentials.baseUrl, credentials.username, credentials.apiToken);
    
    // Validate credentials
    updateLoginStatus('Validating credentials...', 'loading');
    const validation = await jiraService.validateCredentials();
    
    if (validation.valid) {
      console.log('Authentication successful, saving credentials');
      
      // Save credentials in localStorage always for the URL and username
      localStorage.setItem('jira-domain', credentials.baseUrl);
      localStorage.setItem('jira-email', credentials.username);
      
      // Also save token in localStorage if requested
      if (rememberToken) {
        localStorage.setItem('jira-token', credentials.apiToken);
        console.log('Token saved to localStorage');
      } else {
        localStorage.removeItem('jira-token');
        console.log('Token removed from localStorage');
      }
      
      // Save full credentials in electron-store based on remember token flag
      if (rememberToken) {
        // Save full credentials including token
        ipcRenderer.send('save-credentials', credentials);
        updateLoginStatus('Successfully connected! Token saved for future sessions.', 'success');
      } else {
        // Save credentials without the token by explicitly setting it to empty
        ipcRenderer.send('save-credentials', {
          baseUrl: credentials.baseUrl,
          username: credentials.username,
          apiToken: '' // Explicitly clear the token
        });
        updateLoginStatus('Connected successfully! Token not saved.', 'success');
      }
      
      // Check permissions
      if (validation.permissions && validation.permissions.canLogWork === false) {
        // Show warning but continue
        const permissionWarning = document.createElement('div');
        permissionWarning.classList.add('warning-message');
        permissionWarning.textContent = 'Warning: Your Jira account doesn\'t have "Work On Issues" permission. You might not be able to log work on some or all issues.';
        document.body.appendChild(permissionWarning);
        
        setTimeout(() => {
          if (document.body.contains(permissionWarning)) {
            document.body.removeChild(permissionWarning);
          }
        }, 8000);
      }
      
      // Load projects
      await loadProjects();
      
      // Show project section
      showProjectSection();
    } else {
      // Show error in login status
      updateLoginStatus('Invalid credentials or connection error', 'error');
      document.getElementById('login-button').disabled = false;
      
      // Add a button to get API token
      const tokenButton = document.createElement('button');
      tokenButton.textContent = 'Get API Token';
      tokenButton.classList.add('secondary-button');
      tokenButton.style.marginTop = '10px';
      tokenButton.style.marginLeft = '10px';
      tokenButton.onclick = () => {
        window.open('https://id.atlassian.com/manage-profile/security/api-tokens', '_blank');
      };
      
      // Check if already added
      const existingButton = document.querySelector('#login-status + button');
      if (!existingButton) {
        loginStatusDiv.parentNode.insertBefore(tokenButton, loginStatusDiv.nextSibling);
      }
    }
  } catch (error) {
    // Show error in login status
    updateLoginStatus(`Authentication error: ${error.message}`, 'error');
    document.getElementById('login-button').disabled = false;
    
    // Add a button to get API token
    const tokenButton = document.createElement('button');
    tokenButton.textContent = 'Get API Token';
    tokenButton.classList.add('secondary-button');
    tokenButton.style.marginTop = '10px';
    tokenButton.style.marginLeft = '10px';
    tokenButton.onclick = () => {
      window.open('https://id.atlassian.com/manage-profile/security/api-tokens', '_blank');
    };
    
    // Check if already added
    const existingButton = document.querySelector('#login-status + button');
    if (!existingButton) {
      loginStatusDiv.parentNode.insertBefore(tokenButton, loginStatusDiv.nextSibling);
    }
  }
}

// Load projects from Jira
async function loadProjects() {
  try {
    const projects = await jiraService.getProjects();
    
    // Clear existing options
    projectSelect.innerHTML = '<option value="">Select a project</option>';
    
    // Add new options
    projects.forEach(project => {
      const option = document.createElement('option');
      option.value = project.key;
      option.textContent = project.name;
      projectSelect.appendChild(option);
    });
  } catch (error) {
    alert(`Error loading projects: ${error.message}`);
  }
}

// Load issues for a project
async function loadIssuesForProject(projectKey) {
  try {
    const issues = await jiraService.getIssuesForProject(projectKey);
    
    // Clear existing options
    issueSelect.innerHTML = '<option value="">Select an issue</option>';
    
    // Add new options
    issues.forEach(issue => {
      const option = document.createElement('option');
      option.value = issue.key;
      option.textContent = `${issue.key}: ${issue.fields.summary}`;
      
      // Check if the issue might be restricted
      const status = issue.fields.status ? issue.fields.status.name : '';
      const isResolved = status.toLowerCase().includes('done') || 
                         status.toLowerCase().includes('resolved') || 
                         status.toLowerCase().includes('closed');
      
      if (isResolved) {
        option.setAttribute('data-status', status);
        option.textContent = `${issue.key}: ${issue.fields.summary} (${status})`;
      }
      
      issueSelect.appendChild(option);
    });
    
    // Add event listener for issue selection to show status warnings
    issueSelect.addEventListener('change', () => {
      const selectedOption = issueSelect.options[issueSelect.selectedIndex];
      const status = selectedOption.getAttribute('data-status');
      
      // Remove any existing warnings
      const existingWarning = document.querySelector('.status-warning');
      if (existingWarning) {
        existingWarning.remove();
      }
      
      // Show warning for resolved issues
      if (status) {
        const warningDiv = document.createElement('div');
        warningDiv.classList.add('status-warning');
        warningDiv.textContent = `Note: This issue is in "${status}" status. You might not have permission to log work on it.`;
        warningDiv.style.color = '#FF9800';
        warningDiv.style.marginTop = '5px';
        warningDiv.style.fontSize = '14px';
        
        // Insert after issue select
        issueSelect.parentNode.insertBefore(warningDiv, issueSelect.nextSibling);
      }
    });
    
  } catch (error) {
    alert(`Error loading issues: ${error.message}`);
  }
}

// Start tracking time for an issue
function startTracking(projectKey, issueKey) {
  const projectName = projectSelect.options[projectSelect.selectedIndex].text;
  const issueName = issueSelect.options[issueSelect.selectedIndex].text;
  
  currentIssue = issueKey;
  startTime = new Date();
  
  // Update display
  currentProjectSpan.textContent = projectName;
  currentIssueSpan.textContent = issueName;
  startTimeSpan.textContent = startTime.toLocaleTimeString();
  
  // Send tracking data to main process
  ipcRenderer.send('start-tracking', { 
    projectKey, 
    issueKey, 
    projectName, 
    issueName,
    startTime: startTime.toISOString() 
  });
  
  // Calculate reminder interval in minutes
  const reminderHours = parseInt(reminderHoursInput.value) || 0;
  const reminderMinutes = parseInt(reminderMinutesInput.value) || 0;
  const totalReminderMinutes = (reminderHours * 60) + reminderMinutes;
  
  // Set reminder if time is > 0
  if (totalReminderMinutes > 0) {
    ipcRenderer.send('set-reminder', totalReminderMinutes);
  }
  
  // Start timer
  timerInterval = setInterval(updateElapsedTime, 1000);
  
  // Show tracking section
  showTrackingSection();
}

// Update the elapsed time display
function updateElapsedTime() {
  if (!startTime) return;
  
  const now = new Date();
  const elapsed = Math.floor((now - startTime) / 1000);
  
  const hours = Math.floor(elapsed / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
  const seconds = Math.floor(elapsed % 60).toString().padStart(2, '0');
  
  elapsedTimeSpan.textContent = `${hours}:${minutes}:${seconds}`;
  
  // DO NOT automatically fill the time spent input - only update when user clicks "Use Tracked Time"
  // This allows users to enter their own time manually if they prefer
}

// Function to show help about API tokens when the field is focused
function showApiTokenHelp() {
  // Only show this message once per session
  if (localStorage.getItem('api-token-help-shown')) return;
  
  const tokenMessage = document.createElement('div');
  tokenMessage.classList.add('success-message');
  tokenMessage.style.background = '#0747A6'; // Different color to stand out
  tokenMessage.innerHTML = `
    <strong>How to get your API token:</strong><br>
    1. Visit <a href="https://id.atlassian.com/manage-profile/security/api-tokens" 
       target="_blank" style="color: white; text-decoration: underline;">Atlassian Account Settings</a><br>
    2. Click "Create API token"<br>
    3. Give it a name (e.g. "Jira Logger")<br>
    4. Copy the token and paste it here
  `;
  document.body.appendChild(tokenMessage);
  
  // Mark as shown
  localStorage.setItem('api-token-help-shown', 'true');
  
  // Auto-remove after 15 seconds
  setTimeout(() => {
    if (document.body.contains(tokenMessage)) {
      document.body.removeChild(tokenMessage);
    }
  }, 15000);
}

// Add a function to validate Jira time format
function validateJiraTimeFormat(timeString) {
  // If exactly "0m", it's a special case we'll handle
  if (timeString === "0m" || timeString === "0h" || timeString === "0") {
    return true;
  }
  
  // Jira accepts formats like: 1h, 30m, 1h 30m, 1.5h, etc.
  const regex = /^((\d+(\.\d+)?[hH])?\s*(\d+[mM])?|\d+(\.\d+)?[hH]|\d+[mM])$/;
  return regex.test(timeString.trim());
}

// Stop tracking time
function stopTracking() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  
  // Notify main process
  ipcRenderer.send('stop-tracking');
}

// Reset tracking variables
function resetTracking() {
  currentIssue = null;
  startTime = null;
  
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  
  elapsedTimeSpan.textContent = '00:00:00';
}

// UI Section Display Functions
function showLoginSection() {
  loginSection.classList.remove('hidden');
  projectSection.classList.add('hidden');
  trackingSection.classList.add('hidden');
  logWorkSection.classList.add('hidden');
  
  // Reset login status and button
  updateLoginStatus('', null);
  document.getElementById('login-button').disabled = false;
}

function showProjectSection() {
  loginSection.classList.add('hidden');
  projectSection.classList.remove('hidden');
  trackingSection.classList.add('hidden');
  logWorkSection.classList.add('hidden');
}

function showTrackingSection() {
  loginSection.classList.add('hidden');
  projectSection.classList.add('hidden');
  trackingSection.classList.remove('hidden');
  logWorkSection.classList.add('hidden');
}

function showLogWorkSection() {
  loginSection.classList.add('hidden');
  projectSection.classList.add('hidden');
  trackingSection.classList.add('hidden');
  logWorkSection.classList.remove('hidden');
  
  // Clear input fields
  timeSpentInput.value = '';
  workCommentInput.value = '';
  
  // Update the elapsed time display for reference
  if (startTime) {
    const now = new Date();
    const elapsed = Math.floor((now - startTime) / 1000);
    
    const hours = Math.floor(elapsed / 3600).toString().padStart(2, '0');
    const minutes = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
    const seconds = Math.floor(elapsed % 60).toString().padStart(2, '0');
    
    elapsedTimeSpan.textContent = `${hours}:${minutes}:${seconds}`;
  }
}

// Initialize the app
init();