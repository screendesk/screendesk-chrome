import React, { useState } from "react";
import { CopyLinkIcon, MoreActionsIcon } from "../../images/popup/images";

const VideoItem = (props) => {
  // State to manage the copy button text
  const [copyButtonText, setCopyButtonText] = useState("Copy link");

  // Function to handle the copy link action
  const handleCopyLink = (event) => {
    event.stopPropagation(); // Prevent the click event from bubbling up to the parent div
    const link = `https://app.screendesk.io/recordings/${props.uuid}`;
    navigator.clipboard.writeText(link)
      .then(() => {
        // Change button text to "Copied!"
        setCopyButtonText("Copied!");
        // Change the button text back to "Copy link" after 3 seconds
        setTimeout(() => {
          setCopyButtonText("Copy link");
        }, 3000);
      })
      .catch(err => {
        // Error handling
        console.error('Failed to copy link:', err);
      });
  };

  // Function to handle opening the video in a new tab
  const handleOpenVideo = () => {
    const videoUrl = `https://app.screendesk.io/recordings/${props.uuid}`;
    window.open(videoUrl, '_blank'); // Open the video URL in a new tab
  };

  return (
    <div className="video-item-root" tabIndex="0" onClick={handleOpenVideo}>
      <div className="video-item">
        <div className="video-item-left">
          <div
            className="video-item-thumbnail"
            style={{
              backgroundImage: `url(${props.thumbnail})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          ></div>
          <div className="video-item-info">
            <div className="video-item-info-title">{props.title}</div>
            <div className="video-item-info-date">{props.date}</div>
          </div>
        </div>
        <div className="video-item-right">
          <button
            role="button"
            tabIndex="0"
            className="copy-link"
            onClick={handleCopyLink} // Add the onClick event handler here
          >
            <img src={CopyLinkIcon} alt="Copy link" />
            {copyButtonText}
          </button>
          {/* More actions button can be re-enabled and modified as needed */}
        </div>
      </div>
    </div>
  );
};

export default VideoItem;
