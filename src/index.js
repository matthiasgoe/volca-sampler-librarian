import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import './bootstrap.scss';
import SimpleApp from './SimpleApp.js';
import GlobalErrorBoundary from './GlobalErrorBoundary.js';
import reportWebVitals from './reportWebVitals.js';
import { AudioPlaybackContextProvider } from './utils/audioData.js';
import { initPlugins } from './pluginStore';

// polyfills
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function arrayBuffer() {
    return new Response(this).arrayBuffer();
  };
}
if (typeof TouchEvent === 'undefined') {
  window.TouchEvent = /** @type {typeof TouchEvent} */ (
    class TouchEvent extends Event {}
  );
}

ReactDOM.render(
  <React.StrictMode>
    <GlobalErrorBoundary>
      <AudioPlaybackContextProvider>
        <SimpleApp />
      </AudioPlaybackContextProvider>
    </GlobalErrorBoundary>
  </React.StrictMode>,
  document.getElementById('root')
);

initPlugins();
reportWebVitals();
