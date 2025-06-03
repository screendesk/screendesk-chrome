# ScreenDesk Chrome Extension Authentication Flow

This document outlines the authentication flow in the ScreenDesk Chrome extension, focusing on how token authentication is implemented and managed throughout the application.

## Overview

The ScreenDesk Chrome extension uses JWT (JSON Web Token) authentication to authenticate users with the ScreenDesk backend server. The authentication flow involves several components working together to manage the authentication state.

## Authentication Flow

### 1. Initial Authentication Check

When the user clicks on the extension icon:
- The extension sends a message with type `check-auth` to check if the user is already authenticated
- This triggers a check in the ContentState component that verifies if an `auth_token` exists in Chrome's local storage
- **Important**: The extension interface is only shown AFTER successful authentication

```javascript
chrome.action.onClicked.addListener(async () => {
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    chrome.runtime.sendMessage({type: "check-auth"});
  });
});
```

### 2. Token Validation

When the `check-auth` message is received:
- The ContentState component retrieves the `auth_token` from Chrome's local storage
- If a token exists, it makes a request to the backend server to validate the token
- The validation is done by sending a GET request to `https://app.screendesk.io/auth_status` with the token in the Authorization header
- **If token is valid**: The extension interface is immediately shown
- **If token is invalid or missing**: The sign-in page is opened

```javascript
chrome.storage.local.get(['auth_token'], function(result) {
  if (result.auth_token) {
    fetch('https://app.screendesk.io/auth_status', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${result.auth_token}`,
        'Content-Type': 'application/json'
      },
      mode: 'cors'
    })
    .then(response => {
      if(response.ok) {
        console.log('User is authenticated');
        // Show the extension interface since user is authenticated
        setContentState((prevContentState) => ({
          ...prevContentState,
          showPopup: true,
          showExtension: true,
        }));
      } else {
        console.log('Token is invalid, opening sign-in page');
        chrome.runtime.sendMessage({type: "open-sign-in-page"});
      }
    })
    .catch(error => {
      console.error('Error validating token:', error);
      chrome.runtime.sendMessage({type: "open-sign-in-page"});
    });
  } else {
    console.log('No token found, opening sign-in page');
    chrome.runtime.sendMessage({type: "open-sign-in-page"});
  }
});
```

### 3. Sign-In Process

If the user is not authenticated or the token is invalid:
- The extension opens a popup window to the sign-in page (`https://app.screendesk.io/users/sign_in?source=chrome_extension`)
- The popup window is created with specific dimensions (500x700)
- The window ID is stored in `signInWindowId` for later reference
- **Important**: The extension interface is NOT hidden immediately - it waits for authentication to complete

```javascript
chrome.windows.create({
  url: 'https://app.screendesk.io/users/sign_in?source=chrome_extension',
  type: 'popup',
  width: 500,
  height: 700,
  focused: true
}, (window) => {
  signInWindowId = window.id; // Store the window ID
});

// Don't immediately hide the popup - wait for authentication to complete
// chrome.runtime.sendMessage({type: "hide-popup"});
```

### 4. Token Reception and Storage

After successful authentication on the sign-in page:
- The web application sends a message to the extension using `chrome.runtime.onMessageExternal`
- The message contains the JWT token in the `request.token` field
- The extension stores this token in Chrome's local storage as `auth_token`
- The sign-in window is automatically closed after 3 seconds
- **New**: After successful authentication, the extension interface is shown

```javascript
chrome.runtime.onMessageExternal.addListener(
  function(request, sender, sendResponse) {
    if (request.action === "authToken") {
      // Handle the received JWT token
      chrome.storage.local.set({auth_token: request.token}, function() {
        console.log("JWT token stored.");

        // Close the sign in window after 3 seconds
        setTimeout(() => {
          if (signInWindowId) {
            chrome.windows.remove(signInWindowId, () => {
              signInWindowId = null;
            });
          }
        }, 3000);

        // After successful authentication, show the extension interface
        chrome.runtime.sendMessage({type: "show-extension-after-auth"});
      });
    }
  }
);
```

### 5. Using the Token for API Requests

Once authenticated, the token is used for all API requests to the backend server:
- The token is retrieved from Chrome's local storage
- It's included in the Authorization header of API requests
- Example of using the token for uploading a recording:

```javascript
// Handle authentication token retrieval
const { auth_token } = await new Promise((resolve, reject) => {
  chrome.storage.local.get(['auth_token'], function(result) {
    if (chrome.runtime.lastError) {
      reject(chrome.runtime.lastError);
    } else if (result.auth_token) {
      resolve(result);
    } else {
      reject(new Error('Auth token not found'));
    }
  });
});

// Upload the fixed Blob to the server.
const formData = new FormData();
formData.append("recording[file]", fixedBlob, "video.webm");
const response = await fetch("https://app.screendesk.io/chrome/upload", {
  method: "POST",
  headers: {
    'Authorization': `Bearer ${auth_token}`,
  },
  body: formData,
});
```

### 6. Token Usage in Components

Components that need to make authenticated API requests:
- Retrieve the token from Chrome's local storage
- Store it in their state
- Use it for API calls

Example from VideosTab component:

```javascript
useEffect(() => {
  chrome.storage.local.get(['auth_token'], (result) => {
    const token = result.auth_token;
    if (token) {
      setAuthToken(token);
    } else {
      console.error('No auth token found');
    }
  });
}, []);

const fetchVideos = async (endpoint) => {
  if (!endpoint) return;

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      mode: 'cors',
    });
    
    // Process response...
  } catch (error) {
    console.error('There was a problem with the fetch operation:', error);
  }
};
```

## Google Sign-In (Alternative Flow)

The extension also has a separate authentication flow using Google Sign-In:

```javascript
const signIn = async () => {
  try {
    const token = await chrome.identity.getAuthToken({ interactive: true });

    if (!token) {
      throw new Error("User cancelled sign-in or failed to get token");
    }

    // Save token to storage
    await new Promise((resolve) =>
      chrome.storage.local.set({ token: token.token }, () => resolve())
    );

    const userInfo = await chrome.identity.getProfileUserInfo();

    return token.token; // Return the token if sign-in is successful
  } catch (error) {
    console.error("Error signing in:", error.message);
    return null;
    throw error; // Reject the Promise if sign-in fails
  }
};
```

This flow uses Chrome's identity API to get a Google OAuth token, which is stored separately from the main JWT token.

## Sign-Out Process

The extension also includes a sign-out process for Google authentication:

```javascript
const handleSignOutDrive = async () => {
  // Get token
  const { token } = await chrome.storage.local.get(["token"]);
  var url = "https://accounts.google.com/o/oauth2/revoke?token=" + token;
  fetch(url);

  chrome.identity.removeCachedAuthToken({ token: token });
  chrome.storage.local.set({ token: false });
};
```

## Summary

The authentication flow in the ScreenDesk Chrome extension involves:

1. Checking for an existing token in Chrome's local storage
2. Validating the token with the backend server
3. **If authenticated**: Immediately showing the extension interface
4. **If not authenticated**: Opening a sign-in popup and waiting for authentication
5. Receiving and storing the JWT token after successful authentication
6. **After successful authentication**: Showing the extension interface
7. Using the token for all API requests to the backend server
8. Providing a sign-out mechanism

This token-based authentication system allows the extension to securely communicate with the ScreenDesk backend while maintaining user sessions across browser restarts.

## Recent Fix

**Problem**: The extension was incorrectly hiding both the popup window and the recording interface immediately after opening the sign-in page, causing the recording window to close unexpectedly.

**Solution**:
- Removed the immediate `hide-popup` message after opening the sign-in page
- Added proper state management to show the extension interface only after successful authentication
- Added a new message type `show-extension-after-auth` to trigger the interface display after authentication
- The extension now properly waits for authentication to complete before showing the interface

**Key Changes**:
1. **Background script**: Removed immediate `hide-popup` message and added `show-extension-after-auth` message after token storage
2. **ContentState**: Added proper authentication flow handling and new message handler for post-auth interface display
3. **Flow**: Extension interface is now shown only when user is authenticated (either existing valid token or after successful sign-in)
