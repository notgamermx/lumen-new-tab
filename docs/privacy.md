# Privacy

Lumen stores preferences and shortcut URLs in localStorage. One uploaded wallpaper is stored in IndexedDB. These are scoped to the installed extension and browser profile; they are not synced to an account or sent to a server.

The extension does not collect analytics or fetch browsing history. Built-in backgrounds are drawn locally. Video and image files are loaded from the copy saved in the browser.

The optional memory saver asks for the `tabs` permission to inspect open-tab metadata, including website addresses, activity timestamps, pin/audio state, and whether a tab is discarded. It uses this information to skip protected sites and unload inactive tabs. It does not inspect page contents or transmit tab metadata. No tab URLs or titles are saved. Protected domains, memory-saver preferences, and the last run's counts/timestamp are stored locally through `chrome.storage.local`. The `alarms` permission schedules checks only while automatic sleeping is enabled. You can remove tab access from the Memory panel; this disables automatic sleeping.

Submitting a search sends the entered query to the selected search engine. Clicking a shortcut opens that website. Those sites have their own privacy policies.

Use **Remove** under the uploaded wallpaper controls to delete the saved file. Removing the extension clears its browser storage. **Reset appearance & widgets** resets those settings but keeps the wallpaper and shortcut list.
