// Deep link redirect logic
(function() {
    // Get station ID from the page
    const stationId = document.body.dataset.station;
    const stationName = document.body.dataset.stationName || stationId;

    // Custom URL scheme for the app
    const appUrl = `channel://station/${stationId}`;

    // App Store URL (update with actual App Store ID when available)
    const appStoreUrl = 'https://apps.apple.com/app/channel'; // Placeholder

    // Update the page content
    document.getElementById('station-name').textContent = stationName;

    // Try to open the app
    function openApp() {
        // Create a hidden iframe to try opening the app
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = appUrl;
        document.body.appendChild(iframe);

        // Also try direct location change
        window.location.href = appUrl;

        // If still here after 1.5 seconds, redirect to App Store or show download prompt
        setTimeout(function() {
            // Check if we're still on this page (app didn't open)
            document.getElementById('loading').style.display = 'none';
            document.getElementById('download-prompt').style.display = 'block';
        }, 1500);
    }

    // Start the redirect process
    openApp();
})();
