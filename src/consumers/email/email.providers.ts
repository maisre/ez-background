import * as mongoose from 'mongoose';
import { Connection } from 'mongoose';

const OrgSchema = new mongoose.Schema({
  name: { type: String, required: true },
  personal: { type: Boolean, default: false },
  members: [
    {
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
      role: { type: String, enum: ['owner', 'admin', 'member'], required: true },
    },
  ],
  stripeCustomerId: { type: String },
  subscriptionId: { type: String },
  plan: { type: String },
  subscriptionStatus: { type: String },
});

const UserSchema = new mongoose.Schema({
  username: String,
  password: String,
  activeOrg: { type: mongoose.Schema.Types.ObjectId, ref: 'org', required: false },
});

export const emailProviders = [
  {
    provide: 'ORG_MODEL',
    useFactory: (connection: Connection) => connection.model('org', OrgSchema),
    inject: ['DATABASE_CONNECTION'],
  },
  {
    provide: 'USER_MODEL',
    useFactory: (connection: Connection) => connection.model('user', UserSchema),
    inject: ['DATABASE_CONNECTION'],
  },
];
