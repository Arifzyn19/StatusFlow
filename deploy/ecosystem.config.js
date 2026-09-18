module.exports = {
  apps: [
    {
      name: 'statusflow-api',
      cwd: './apps/api',
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '800M',
      error_file: '../../logs/api-error.log',
      out_file: '../../logs/api-out.log',
      time: true,
    },
    {
      name: 'statusflow-web',
      cwd: './apps/web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production', PORT: '3000' },
      max_memory_restart: '600M',
      error_file: '../../logs/web-error.log',
      out_file: '../../logs/web-out.log',
      time: true,
    },
  ],
};
