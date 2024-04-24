import React, { useState, useEffect, useCallback } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import VideoItem from "../components/VideoItem";

const VideosTab = () => {
  const [URL, setURL] = useState("https://m4lkahr28fl.typeform.com/to/HQWoa8Is");
  const [videos, setVideos] = useState([]);
  const [activeTab, setActiveTab] = useState("myVideos");
  const [searchQuery, setSearchQuery] = useState("");
  const [authToken, setAuthToken] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(['auth_token'], (result) => {
      const token = result.auth_token;
      if (token) {
        setAuthToken(token);
      } else {
        console.error('No auth token found');
      }
    });

    const locale = chrome.i18n.getMessage("@@ui_locale");
    if (!locale.includes("en")) {
      setURL(`https://translate.google.com/translate?sl=en&tl=${locale}&u=${URL}`);
    }
  }, []);

  // Debounce function
  const debounce = (func, delay) => {
    let timer;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        func.apply(this, args);
      }, delay);
    };
  };

  const debouncedSearch = useCallback(debounce((query) => {
    if (!authToken) return;

    let endpoint = '';
    setIsLoading(true);

    switch (activeTab) {
      case "myVideos":
        endpoint = `https://app.screendesk.io/chrome/library?query=${encodeURIComponent(query)}`;
        break;
      case "teamVideos":
        endpoint = `https://app.screendesk.io/chrome/library/team_videos?query=${encodeURIComponent(query)}`;
        break;
    }

    if (endpoint) {
      fetchVideos(endpoint);
    }
  }, 500), [activeTab, authToken]); // 500ms delay

  useEffect(() => {
    debouncedSearch(searchQuery);
  }, [searchQuery, debouncedSearch]);

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

      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      const data = await response.json();
      setVideos(data);
    } catch (error) {
      console.error('There was a problem with the fetch operation:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearchInputChange = (e) => {
    setSearchQuery(e.target.value);
  };

  return (
    <div className="video-ui">
      <Tabs.Root className="TabsRoot" defaultValue={activeTab} onValueChange={(value) => {
        setIsLoading(true);
        setActiveTab(value);
      }}>
        <Tabs.List className="TabsList" aria-label="Manage your account">
          <Tabs.Trigger className="TabsTrigger" value="myVideos">My Videos</Tabs.Trigger>
          <Tabs.Trigger className="TabsTrigger" value="teamVideos">Team Videos</Tabs.Trigger>
        </Tabs.List>
        
        {/* Search input can be placed here or within each tab content */}
        <div className="search-input-container">
          <input
            type="text"
            placeholder="Search for videos..."
            value={searchQuery}
            onChange={handleSearchInputChange}
            className="search-input"
          />
        </div>

        {/* Render "myVideos" and "teamVideos" similarly, wrapping them in a "videos-list" div */}
        <Tabs.Content className="TabsContent" value="myVideos">
          {!isLoading && (
            <div className="videos-list">
              {videos.length > 0 ? (
                videos.map((video, i) => (
                  <VideoItem
                    key={i}
                    title={video.name}
                    date={video.date}
                    thumbnail={video.thumbnail}
                    uuid={video.uuid}
                  />
                ))
              ) : (
                <div className="no-videos-container">No videos found.</div>
              )}
            </div>
          )}
        </Tabs.Content>

        <Tabs.Content className="TabsContent" value="teamVideos">
          {!isLoading && (
            <div className="videos-list">
              {videos.length > 0 ? (
                videos.map((video, i) => (
                  <VideoItem
                    key={i}
                    title={video.name}
                    date={video.date}
                    thumbnail={video.thumbnail}
                    uuid={video.uuid}
                  />
                ))
              ) : (
                <div className="no-videos-container">No videos found.</div>
              )}
            </div>
          )}
        </Tabs.Content>

        {isLoading && <div className="loader-container"><span className="loader"></span></div>}

      </Tabs.Root>
    </div>
  );
};

export default VideosTab;
