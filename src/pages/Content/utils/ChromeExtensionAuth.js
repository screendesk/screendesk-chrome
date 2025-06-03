/**
 * Chrome Extension Authentication Handler
 * Manages access tokens, refresh tokens, and automatic token refresh
 */
class ChromeExtensionAuth {
  constructor() {
    this.baseURL = 'http://localhost:3001';
  }

  /**
   * Store tokens from initial authentication
   */
  async storeTokens(accessToken, refreshToken) {
    await chrome.storage.local.set({
      accessToken,
      refreshToken,
      tokenTimestamp: Date.now()
    });
    console.log('Tokens stored successfully');
  }

  /**
   * Get stored access token
   */
  async getAccessToken() {
    const result = await chrome.storage.local.get(['accessToken']);
    return result.accessToken;
  }

  /**
   * Get stored refresh token
   */
  async getRefreshToken() {
    const result = await chrome.storage.local.get(['refreshToken']);
    return result.refreshToken;
  }

  /**
   * Check if we have valid tokens
   */
  async hasValidTokens() {
    const accessToken = await this.getAccessToken();
    const refreshToken = await this.getRefreshToken();
    return !!(accessToken && refreshToken);
  }

  /**
   * Refresh the access token using the refresh token
   */
  async refreshAccessToken() {
    const refreshToken = await this.getRefreshToken();
    
    if (!refreshToken) {
      console.error('No refresh token available');
      return false;
    }

    try {
      console.log('Attempting to refresh access token...');
      const response = await fetch(`${this.baseURL}/chrome/refresh_token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          refresh_token: refreshToken
        })
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Token refresh successful');
        await this.storeTokens(data.access_token, data.refresh_token);
        return true;
      } else {
        console.error('Token refresh failed:', response.status);
        return false;
      }
    } catch (error) {
      console.error('Token refresh error:', error);
      return false;
    }
  }

  /**
   * Make authenticated request with automatic token refresh
   */
  async authenticatedFetch(url, options = {}) {
    const accessToken = await this.getAccessToken();
    
    if (!accessToken) {
      throw new Error('No access token available');
    }

    // Add auth header
    options.headers = {
      ...options.headers,
      'Authorization': `Bearer ${accessToken}`
    };

    console.log('Making authenticated request to:', url);
    let response = await fetch(url, options);

    // If unauthorized, try to refresh token
    if (response.status === 401) {
      console.log('Received 401, attempting token refresh...');
      const refreshed = await this.refreshAccessToken();
      
      if (refreshed) {
        // Retry with new token
        const newAccessToken = await this.getAccessToken();
        options.headers['Authorization'] = `Bearer ${newAccessToken}`;
        console.log('Retrying request with new token...');
        response = await fetch(url, options);
      } else {
        // Refresh failed, clear tokens and redirect to auth
        console.log('Token refresh failed, clearing tokens');
        await this.clearTokens();
        this.redirectToAuth();
        throw new Error('Authentication required');
      }
    }

    return response;
  }

  /**
   * Validate current access token with the server
   */
  async validateToken() {
    try {
      const response = await this.authenticatedFetch(`${this.baseURL}/auth_status`);
      return response.ok;
    } catch (error) {
      console.error('Token validation failed:', error);
      return false;
    }
  }

  /**
   * Clear stored tokens
   */
  async clearTokens() {
    await chrome.storage.local.remove(['accessToken', 'refreshToken', 'tokenTimestamp', 'auth_token']);
    console.log('All tokens cleared from storage');
  }

  /**
   * Redirect to authentication
   */
  redirectToAuth() {
    console.log('Redirecting to authentication...');
    chrome.runtime.sendMessage({type: "open-sign-in-page"});
  }

  /**
   * Check if user is authenticated and tokens are valid
   */
  async checkAuthStatus() {
    const hasTokens = await this.hasValidTokens();
    
    if (!hasTokens) {
      console.log('No tokens found');
      return false;
    }

    // Try to validate the token
    const isValid = await this.validateToken();
    
    if (!isValid) {
      console.log('Token validation failed');
      await this.clearTokens();
      return false;
    }

    console.log('User is authenticated');
    return true;
  }
}

export default ChromeExtensionAuth;
