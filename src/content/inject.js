// This script runs in the "Main World" (page context)
(function () {
    // console.log("[Extension Injection] Audio Interceptor Active");

    let isHunting = false;
    let huntTimer = null;

    // Listen for commands from Content Script
    window.addEventListener('message', (event) => {
        if (event.data.type === 'CMD_HUNT_AUDIO') {
            // console.log("[Injector] Hunting for next audio...");
            isHunting = true;
            // Timeout hunt after 5s to avoid pausing random user plays later
            if (huntTimer) clearTimeout(huntTimer);
            huntTimer = setTimeout(() => { isHunting = false; }, 5000);
        }
    });

    // Patch HTMLMediaElement (covers <audio> and new Audio())
    const originalPlay = HTMLMediaElement.prototype.play;

    HTMLMediaElement.prototype.play = function () {
        const promise = originalPlay.apply(this, arguments);

        // Check if we are "hunting" for this playback
        if (isHunting && this.src) {
            // console.log("[Injector] Intercepted Target Audio:", this.src);

            // Broadcast finding
            window.postMessage({
                type: 'WA_AUDIO_INTERCEPT',
                src: this.src
            }, '*');

            // Stop Hunting
            isHunting = false;
            if (huntTimer) clearTimeout(huntTimer);

            // PAUSE IT IMMEDIATELY
            // We wait a tiny bit to ensure the Promise resolves or buffering starts, 
            // otherwise it might throw "The play() request was interrupted"
            if (promise !== undefined) {
                promise.then(() => {
                    // console.log("[Injector] Pausing now.");
                    this.pause();
                    this.currentTime = 0; // Reset
                }).catch(error => {
                    // console.error("[Injector] Play promise error:", error);
                    // If it failed to play, we might still have the src? 
                    // Usually standard behavior.
                });
            } else {
                setTimeout(() => { this.pause(); }, 50);
            }
        }

        return promise;
    };
})();
