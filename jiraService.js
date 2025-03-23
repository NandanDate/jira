// jiraService.js - Handles all Jira API interactions
const axios = require('axios');
const fetch = require('node-fetch');

class JiraService {
  constructor(baseUrl, username, apiToken) {
    this.baseUrl = baseUrl;
    this.auth = {
      username: username,
      password: apiToken
    };
    
    // Create a reusable axios instance with auth headers
    this.client = axios.create({
      baseURL: baseUrl,
      auth: this.auth,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
  }

  // Initialize with stored credentials
  static initialize(credentials) {
    if (!credentials || !credentials.baseUrl || !credentials.username || !credentials.apiToken) {
      return null;
    }
    return new JiraService(credentials.baseUrl, credentials.username, credentials.apiToken);
  }

  // Validate credentials by attempting to fetch user info and permissions
  async validateCredentials() {
    try {
      // First validate basic authentication
      const response = await this.client.get('/rest/api/3/myself');
      console.log('Validation response:', response.status);
      
      // Now check for permissions
      try {
        // Get current user permissions for a sample project or issue
        const permissionsResponse = await this.client.get('/rest/api/3/mypermissions', {
          params: {
            permissions: 'WORK_ON_ISSUES,BROWSE_PROJECTS'
          }
        });
        
        console.log('Permissions check:', permissionsResponse.status);
        const permissions = permissionsResponse.data.permissions;
        
        // Check if user has the WORK_ON_ISSUES permission
        const canLogWork = permissions.WORK_ON_ISSUES && permissions.WORK_ON_ISSUES.havePermission;
        
        if (!canLogWork) {
          console.warn('User does not have WORK_ON_ISSUES permission');
        }
        
        return { 
          valid: true, 
          user: response.data,
          permissions: {
            canLogWork,
            permissionsData: permissions
          }
        };
      } catch (permError) {
        console.warn('Could not check permissions:', permError.message);
        // Continue even if permissions check fails
        return { valid: true, user: response.data, permissions: { canLogWork: null } };
      }
    } catch (error) {
      console.error('Validation error:', error.message);
      if (error.response) {
        console.error('Error status:', error.response.status);
        console.error('Error data:', error.response.data);
      }
      return { valid: false, error: error.message };
    }
  }

  // Get all projects
  async getProjects() {
    try {
      const response = await this.client.get('/rest/api/2/project');
      return response.data;
    } catch (error) {
      console.error('Error fetching projects:', error.message);
      if (error.response) {
        console.error('Error status:', error.response.status);
        console.error('Error data:', error.response.data);
      }
      throw error;
    }
  }

  // Get issues for a specific project
  async getIssuesForProject(projectKey) {
    try {
      const response = await this.client.get('/rest/api/2/search', {
        params: {
          jql: `project=${projectKey} ORDER BY updated DESC`,
          maxResults: 50
        }
      });
      return response.data.issues;
    } catch (error) {
      console.error('Error fetching issues:', error.message);
      if (error.response) {
        console.error('Error status:', error.response.status);
        console.error('Error data:', error.response.data);
      }
      throw error;
    }
  }

  // Create a new issue
  async createIssue(projectKey, summary, issueType = 'Task') {
    try {
      // Validate and standardize issue type
      let typeToUse = 'Task'; // Default to Task
      
      // Only allow specific issue types
      if (issueType) {
        const normalizedType = issueType.trim().toLowerCase();
        if (normalizedType === 'bug') {
          typeToUse = 'Bug';
        } else if (normalizedType === 'story') {
          typeToUse = 'Story';
        } else if (normalizedType === 'task') {
          typeToUse = 'Task';
        }
      }
      
      const payload = {
        fields: {
          project: {
            key: projectKey
          },
          summary: summary,
          issuetype: {
            name: typeToUse
          }
        }
      };
      
      console.log('Creating issue with payload:', JSON.stringify(payload, null, 2));
      
      // Create basic auth header
      const authHeader = `Basic ${Buffer.from(`${this.auth.username}:${this.auth.password}`).toString('base64')}`;
      
      // Use native fetch to bypass the XSRF checks instead of axios
      const response = await fetch(`${this.baseUrl}/rest/api/3/issue`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Atlassian-Token': 'no-check'
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        // Handle non-200 responses
        const responseText = await response.text();
        const statusCode = response.status;
        console.error(`Fetch error ${statusCode}: ${responseText}`);
        
        let errorMessage = `Failed to create issue. Status: ${statusCode}`;
        
        if (responseText) {
          try {
            // Try to parse as JSON
            const errorData = JSON.parse(responseText);
            if (errorData.errorMessages) {
              errorMessage = errorData.errorMessages.join('. ');
            } else if (errorData.message) {
              errorMessage = errorData.message;
            }
          } catch (e) {
            // If not JSON, use as text
            errorMessage = responseText;
          }
        }
        
        throw new Error(errorMessage);
      }
      
      // Success response
      const responseData = await response.json();
      console.log(`Issue created successfully with key: ${responseData.key}`);
      return responseData;
    } catch (error) {
      console.error('Error creating issue:', error.message);
      
      // Add user-friendly error message
      let errorMessage = 'Failed to create issue. ';
      
      // If we have an error.status from fetch, use that
      if (error.status) {
        switch (error.status) {
          case 401:
            errorMessage += 'Authentication failed. Please check your username and API token.';
            break;
          case 403:
            errorMessage += 'You don\'t have permission to create issues. Please check your Jira permissions.';
            break;
          case 400:
            errorMessage += 'Bad request. The issue data is invalid.';
            break;
        }
      } else {
        // Just use the original error message
        errorMessage += error.message;
      }
      
      // Create a better error object
      const enhancedError = new Error(errorMessage);
      enhancedError.originalError = error;
      
      throw enhancedError;
    }
  }

  // Create an issue with a custom payload
  async createIssueWithPayload(payload) {
    try {
      // If issuetype is empty or invalid, set it to 'Task'
      if (payload.fields && payload.fields.issuetype) {
        // Default to Task
        let typeToUse = 'Task';
        
        // If there's a name value, validate it
        if (payload.fields.issuetype.name) {
          const normalizedType = payload.fields.issuetype.name.trim().toLowerCase();
          if (normalizedType === 'bug') {
            typeToUse = 'Bug';
          } else if (normalizedType === 'story') {
            typeToUse = 'Story';
          } else if (normalizedType === 'task') {
            typeToUse = 'Task';
          }
        }
        
        // Update the payload with the validated issue type
        payload.fields.issuetype.name = typeToUse;
      }
      
      console.log('Creating issue with payload:', JSON.stringify(payload, null, 2));
      
      // Create basic auth header
      const authHeader = `Basic ${Buffer.from(`${this.auth.username}:${this.auth.password}`).toString('base64')}`;
      
      // Use native fetch to bypass the XSRF checks instead of axios
      const response = await fetch(`${this.baseUrl}/rest/api/3/issue`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Atlassian-Token': 'no-check'
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        // Handle non-200 responses
        const responseText = await response.text();
        const statusCode = response.status;
        console.error(`Fetch error ${statusCode}: ${responseText}`);
        
        let errorMessage = `Failed to create issue. Status: ${statusCode}`;
        
        if (responseText) {
          try {
            // Try to parse as JSON
            const errorData = JSON.parse(responseText);
            if (errorData.errorMessages) {
              errorMessage = errorData.errorMessages.join('. ');
            } else if (errorData.message) {
              errorMessage = errorData.message;
            }
          } catch (e) {
            // If not JSON, use as text
            errorMessage = responseText;
          }
        }
        
        throw new Error(errorMessage);
      }
      
      // Success response
      const responseData = await response.json();
      console.log(`Issue created successfully with key: ${responseData.key}`);
      return responseData;
    } catch (error) {
      console.error('Error creating issue with custom payload:', error.message);
      
      // Add user-friendly error message
      let errorMessage = 'Failed to create issue. ';
      
      // If we have an error.status from fetch, use that
      if (error.status) {
        switch (error.status) {
          case 401:
            errorMessage += 'Authentication failed. Please check your username and API token.';
            break;
          case 403:
            errorMessage += 'You don\'t have permission to create issues. Please check your Jira permissions.';
            break;
          case 400:
            errorMessage += 'Bad request. The issue data is invalid.';
            break;
        }
      } else {
        // Just use the original error message
        errorMessage += error.message;
      }
      
      // Create a better error object
      const enhancedError = new Error(errorMessage);
      enhancedError.originalError = error;
      
      throw enhancedError;
    }
  }

  // Convert time format (e.g., "1h 30m") to seconds
  timeSpentToSeconds(timeSpent) {
    let totalSeconds = 0;
    
    // Handle special case of "0m" or similar zero inputs
    if (timeSpent === "0m" || timeSpent === "0h" || timeSpent === "0") {
      return 60; // Return minimum of 1 minute (60 seconds)
    }
    
    // Match hours
    const hoursMatch = timeSpent.match(/(\d+(\.\d+)?)[hH]/);
    if (hoursMatch) {
      totalSeconds += parseFloat(hoursMatch[1]) * 3600;
    }
    
    // Match minutes
    const minutesMatch = timeSpent.match(/(\d+)[mM]/);
    if (minutesMatch) {
      totalSeconds += parseInt(minutesMatch[1]) * 60;
    }
    
    // If no matches found but there's a decimal number, assume it's hours
    if (!hoursMatch && !minutesMatch) {
      const decimalHours = parseFloat(timeSpent);
      if (!isNaN(decimalHours)) {
        totalSeconds = decimalHours * 3600;
      }
    }
    
    // Ensure minimum time is 1 minute (60 seconds)
    if (totalSeconds < 60) {
      totalSeconds = 60;
    }
    
    return Math.round(totalSeconds);
  }

  // Log work on an issue using API v3 with structured comment
  async logWork(issueKey, timeSpent, comment, started) {
    try {
      console.log(`Logging work on issue ${issueKey}: ${timeSpent} - "${comment}"`);
      
      // Special case for zero values - use 1m as minimum
      let timeToLog = timeSpent;
      if (timeSpent === "0m" || timeSpent === "0h" || timeSpent === "0") {
        console.log("Converting zero time input to 1m minimum");
        timeToLog = "1m";
      }
      
      // Try using direct fetch with v2 API - bypassing axios to avoid XSRF issues
      console.log('Attempting direct fetch approach with API v2');
      
      // Create basic auth header
      const authHeader = `Basic ${Buffer.from(`${this.auth.username}:${this.auth.password}`).toString('base64')}`;
      
      // Simple format worklog data
      const simpleWorklogData = {
        timeSpent: timeToLog,
        comment: comment || ""
      };
      
      if (started) {
        simpleWorklogData.started = started;
      }
      
      console.log('Using fetch with data:', JSON.stringify(simpleWorklogData, null, 2));
      
      // Use native fetch to bypass the XSRF checks
      const response = await fetch(`${this.baseUrl}/rest/api/2/issue/${issueKey}/worklog`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Atlassian-Token': 'no-check'
        },
        body: JSON.stringify(simpleWorklogData)
      });
      
      if (!response.ok) {
        // Handle non-200 responses
        const responseText = await response.text();
        const statusCode = response.status;
        console.error(`Fetch error ${statusCode}: ${responseText}`);
        
        let errorMessage = `Failed to log work. Status: ${statusCode}`;
        
        if (responseText) {
          try {
            // Try to parse as JSON
            const errorData = JSON.parse(responseText);
            if (errorData.errorMessages) {
              errorMessage = errorData.errorMessages.join('. ');
            } else if (errorData.message) {
              errorMessage = errorData.message;
            }
          } catch (e) {
            // If not JSON, use as text
            errorMessage = responseText;
          }
        }
        
        throw new Error(errorMessage);
      }
      
      // Success response
      const responseData = await response.json();
      console.log(`Work logged successfully with ID: ${responseData.id}`);
      return responseData;
    } catch (error) {
      console.error('Error logging work:', error.message);
      
      // Add user-friendly error message
      let errorMessage = 'Failed to log work. ';
      
      // If we have an error.status from fetch, use that
      if (error.status) {
        switch (error.status) {
          case 401:
            errorMessage += 'Authentication failed. Please check your username and API token.';
            break;
          case 403:
            errorMessage += 'You don\'t have permission to log work on this issue. Please check your Jira permissions.';
            break;
          case 404:
            errorMessage += 'Issue not found. The issue may have been deleted or you don\'t have access to it.';
            break;
          case 400:
            errorMessage += 'Bad request. The time format or work log data is invalid.';
            break;
        }
      } else {
        // Just use the original error message
        errorMessage += error.message;
      }
      
      // Create a better error object
      const enhancedError = new Error(errorMessage);
      enhancedError.originalError = error;
      
      throw enhancedError;
    }
  }

  // Switch to v3 API for all methods if needed
  switchToV3Api() {
    // Change base URL in client for all requests
    this.client = axios.create({
      baseURL: this.baseUrl,
      auth: this.auth,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
  }
}

module.exports = JiraService;