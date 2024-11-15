import React, { useState } from "react";
import { CopyLinkIcon } from "../../images/popup/images";

const VideoItem = (props) => {
  const [isHovered, setIsHovered] = useState(false);
  const [copyLinkText, setCopyLinkText] = useState("Copy link");
  const [copyGifText, setCopyGifText] = useState("Copy GIF");

  const handleCopyLink = (event) => {
    event.stopPropagation();
    const link = `https://app.screendesk.io/recordings/${props.uuid}`;
    copyToClipboard(link, setCopyLinkText);
  };

  const handleCopyGif = (event) => {
    event.stopPropagation();
    const htmlContent = `
      <div>
        <a href="https://app.screendesk.io/recordings/${props.uuid}">
          <p>${props.title} - Watch Video</p>
        </a>
        <a href="${props.gif}">
          <img style="max-width:300px;" src="${props.gif}">
        </a>
      </div>
    `;
    copyRichContentToClipboard(htmlContent, setCopyGifText);
  };

  const copyToClipboard = (text, setButtonText) => {
    navigator.clipboard.writeText(text)
      .then(() => {
        setButtonText("Copied!");
        setTimeout(() => setButtonText("Copy link"), 3000);
      })
      .catch(err => console.error('Failed to copy:', err));
  };

  const copyRichContentToClipboard = (htmlContent, setButtonText) => {
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const item = new ClipboardItem({ 'text/html': blob });
    navigator.clipboard.write([item])
      .then(() => {
        setButtonText("Copied!");
        setTimeout(() => setButtonText("Copy GIF"), 3000);
      })
      .catch(err => console.error('Failed to copy GIF:', err));
  };

  const handleOpenVideo = () => {
    const videoUrl = `https://app.screendesk.io/recordings/${props.uuid}`;
    window.open(videoUrl, '_blank');
  };

  return (
    <div 
      className="video-item-root" 
      tabIndex="0" 
      onClick={handleOpenVideo}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
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
        {isHovered && (
          <div className="video-item-right">
            <button
              role="button"
              tabIndex="0"
              className="copy-link"
              onClick={handleCopyLink}
            >
              <img src={CopyLinkIcon} alt="Copy link" />
              {copyLinkText}
            </button>
            <button
              role="button"
              tabIndex="0"
              className="copy-link"
              onClick={handleCopyGif}
            >
              <img src={CopyLinkIcon} alt="Copy GIF" />
              {copyGifText}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoItem;