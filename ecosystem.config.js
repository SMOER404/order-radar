// Запуск без Docker: pm2 start ecosystem.config.js && pm2 save
module.exports = {
  apps: [
    {
      name: 'order-radar',
      script: 'dist/main.js',
      cwd: __dirname,
      node_args: '--env-file=.env',
      instances: 1,
      autorestart: true,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'production', TZ: 'Europe/Moscow' },
    },
  ],
};
