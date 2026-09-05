module.exports = {
  apps: [
    {
      name: "wgl-cabinet",
      script: "server.js",
      cwd: "/var/www/wgl-cabinet/server",
      env: {
        PORT: "6020",
        WGL_DATA_DIR: "/var/lib/wgl-cabinet/data",
        WGL_UPLOADS_DIR: "/var/lib/wgl-cabinet/uploads",
      },
    },
  ],
};
