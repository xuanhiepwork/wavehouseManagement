// Schema validation/client generation only: no environment loading and no database URL.
import { defineConfig } from 'prisma/config';

export default defineConfig({
    schema: 'prisma/schema.prisma',
});
