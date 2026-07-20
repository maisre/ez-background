import * as mongoose from 'mongoose';
import { Connection } from 'mongoose';

// Slim projections of the ez-api `pages` / `layouts` collections holding only
// the fields the screenshot worker reads or writes. Same pattern as
// email.providers.ts: ez-background owns its own read models rather than
// importing ez-api's schemas. Keep the field names in sync with
// ez-api/src/{pages,layouts}/schemas/*.schema.ts.
const shotFields = {
  name: String,
  status: String,
  deletedAt: Date,
  org: mongoose.Schema.Types.ObjectId,
  contentUpdatedAt: Date,
  screenshotAt: Date,
  thumbnailUrl: String,
  screenshotQueuedFor: Date,
  screenshotQueuedAt: Date,
};

export const SHOT_PAGES_MODEL = 'SHOT_PAGES_MODEL';
export const SHOT_LAYOUTS_MODEL = 'SHOT_LAYOUTS_MODEL';

export const screenshotProviders = [
  {
    provide: SHOT_PAGES_MODEL,
    useFactory: (connection: Connection) =>
      connection.model('pages', new mongoose.Schema(shotFields)),
    inject: ['DATABASE_CONNECTION'],
  },
  {
    provide: SHOT_LAYOUTS_MODEL,
    useFactory: (connection: Connection) =>
      connection.model('layouts', new mongoose.Schema(shotFields)),
    inject: ['DATABASE_CONNECTION'],
  },
];
