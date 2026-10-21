(() => {
  "use strict";

  const sites = [
    {
      id: "netflix",
      name: "Netflix",
      domains: ["netflix.com"],
      player:
        '.watch-video, .VideoContainer, .NFPlayer, [data-uia="watch-video"]',
      intro: '[data-uia="player-skip-intro"]',
      recap: '[data-uia="player-skip-recap"]',
      next: '[data-uia="next-episode-seamless-button"]',
    },
    {
      id: "prime",
      name: "Prime Video",
      domains: [
        "primevideo.com",
        "amazon.com",
        "amazon.co.uk",
        "amazon.de",
        "amazon.co.jp",
        "amazon.in",
        "amazon.ca",
        "amazon.com.au",
        "amazon.fr",
        "amazon.it",
        "amazon.es",
        "amazon.com.br",
        "amazon.com.mx",
      ],
      player:
        ".webPlayerSDKContainer, .atvwebplayersdk-player-container, #dv-web-player",
      intro: "",
      recap: "",
      next: "",
    },
    {
      id: "disney",
      name: "Disney+",
      domains: ["disneyplus.com"],
      player:
        "#web-player, .btm-media-client-element, .video_view, .video-view",
      intro: "",
      recap: "",
      next: '[data-testid="up-next-play-button"]',
    },
  ].map(Object.freeze);
  globalThis.BypassStreaming = Object.freeze({
    keys: Object.freeze(["skipIntro", "skipRecap", "autoNext"]),
    site(host) {
      return (
        sites.find((s) =>
          s.domains.some((d) => host === d || host.endsWith(`.${d}`)),
        ) || null
      );
    },
  });
})();
