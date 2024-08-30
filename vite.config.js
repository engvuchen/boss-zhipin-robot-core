const Path = require('path');
const { defineConfig } = require('vite');

// https://vitejs.dev/config/
export default env => {
    return defineConfig({
        plugins: [],
        resolve: {
            alias: {},
        },
        build: {
            outDir: Path.join(__dirname, 'window-build'),
            emptyOutDir: true,
            esbuild: {
                pure: ['console.log'], // 删除 console.log
                drop: ['debugger'], // 删除 debugger
            },
            reportCompressedSize: false, // 启用/禁用 gzip 压缩大小报告。压缩大型输出文件可能会很慢，因此禁用该功能可能会提高大型项目的构建性能。
            rollupOptions: {
                input: {
                    main: Path.join(__dirname, './window/index.js'), // 入口 JavaScript 文件路径
                },
                output: {
                    entryFileNames: 'index.js', // 输出的 JavaScript 文件名
                    chunkFileNames: 'chunks/[name]-[hash].js', // 输出的分块文件名
                    assetFileNames: undefined, // 不输出其他类型的文件（如样式表和 HTML）
                    manualChunks: undefined, // 禁用代码分割
                },
            },
        },
    });
};
