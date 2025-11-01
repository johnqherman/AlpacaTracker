module.exports = {
  apps: [
    {
      name: 'alpaca-tracker',
      script: 'src/monitor.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '100M',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};