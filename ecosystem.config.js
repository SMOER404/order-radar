// Запуск без Docker: pm2 start ecosystem.config.js && pm2 save
module.exports = {
  apps: [
    {
      name: 'order-radar',
      script: 'dist/main.js',
      cwd: __dirname,
      // абсолютный путь: pm2 разрешает node_args относительно своего каталога
      node_args: `--env-file=${__dirname}/.env`,
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'production', TZ: 'Europe/Moscow' },
    },
  ],
};
