// tsconfig-paths-bootstrap.js
// Registers TypeScript path aliases for the compiled production build.
// Required because Node.js does not understand @common/*, @modules/* etc.
const tsConfigPaths = require('tsconfig-paths');
const path = require('path');

tsConfigPaths.register({
    baseUrl: path.join(__dirname, 'dist'),
    paths: {
        '@common/*': ['common/*'],
        '@config/*': ['config/*'],
        '@modules/*': ['modules/*'],
    },
});