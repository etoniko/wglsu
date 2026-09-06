import { Client } from "ssh2";
const conf = `server {
    listen 80;
    listen [::]:80;
    server_name sixz.ru www.sixz.ru;
    return 301 https://sixz.ru$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name sixz.ru www.sixz.ru;

    ssl_certificate /etc/letsencrypt/live/sixz.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sixz.ru/privkey.pem;

    client_max_body_size 30m;

    location /api/ {
        client_max_body_size 30m;
        proxy_pass http://127.0.0.1:6020;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }

    location /ws {
        proxy_pass http://127.0.0.1:6020;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
    }

    location /uploads/ {
        proxy_pass http://127.0.0.1:6020;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ~ ^/(cabinet|g|id|user|rating|community|assets|brand|photo|video)(/|$) {
        proxy_pass http://127.0.0.1:6020;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    root /root/discord/public;
    add_header Cache-Control no-store always;
    add_header Pragma no-cache always;
    index sixz.html;

    location /socket.io/ {
        proxy_pass http://127.0.0.1:6012/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location = /health {
        proxy_pass http://127.0.0.1:6012/health;
        proxy_set_header Host $host;
    }

    location / {
        try_files $uri $uri/ /sixz.html;
    }
}
`;
const c = new Client();
c.on("ready", () => {
  c.sftp((err, sftp) => {
    if (err) throw err;
    const ws = sftp.createWriteStream("/etc/nginx/sites-enabled/sixz.ru");
    ws.on("close", () => {
      c.exec("nginx -t && systemctl reload nginx && echo NGINX_OK", (e2, s) => {
        let o = "";
        s.on("data", (d) => (o += d));
        s.stderr.on("data", (d) => (o += d));
        s.on("close", (code) => { console.log(o); console.log("exit", code); c.end(); });
      });
    });
    ws.end(conf);
  });
}).connect({ host: "sixz.ru", username: "root", password: process.env.DEPLOY_PASS });
