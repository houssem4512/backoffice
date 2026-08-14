/**
 * Seed script — populates MongoDB with realistic demo data.
 *
 * Usage:
 *   cd backend
 *   npm run seed
 *
 * Idempotent — drops existing data and reseeds.
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { connectDB } from '../config/database';
import { User } from '../models/User';
import { Candidate } from '../models/Candidate';
import { Company } from '../models/Company';
import { Prospect } from '../models/Prospect';
import { Order } from '../models/Order';
import { Payment } from '../models/Payment';
import { MarketingChannel } from '../models/MarketingChannel';
import { ActivityLog } from '../models/ActivityLog';

const FIRST_NAMES = ['Lucas', 'Emma', 'Liam', 'Chloé', 'Noah', 'Léa', 'Gabriel', 'Manon', 'Raphaël', 'Jade', 'Louis', 'Alice', 'Adam', 'Camille', 'Hugo', 'Sarah', 'Jules', 'Nora', 'Arthur', 'Inès', 'Mehdi', 'Yasmine', 'Karim', 'Sofia'];
const LAST_NAMES = ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Garcia', 'Roux', 'Fournier', 'Morel', 'Girard', 'Andre', 'Mercier', 'Blanc', 'Benali', 'Haddad', 'Cherif', 'Mansour'];
const CITIES = ['Paris', 'Lyon', 'Berlin', 'Londres', 'Madrid', 'Tunis', 'Sfax'];
const POSITIONS = ['Agent call center', 'Superviseur', 'Team Leader', 'Responsable'];
const ACTIVITIES = ['Télévente', 'Support client', 'Accueil', 'Fidélisation'];
const OPERATIONS = ['Inbound', 'Outbound', 'Mixte'];
const LANGUAGES = ['Français', 'Anglais', 'Allemand', 'Espagnol', 'Italien', 'Arabe', 'Néerlandais'];
const SOURCES: ('Formulaire site' | 'Import Facebook')[] = ['Formulaire site', 'Import Facebook'];
const STATUSES: ('Disponible' | 'En process' | 'Livré' | 'Indisponible' | 'Désinscrit')[] = ['Disponible', 'En process', 'Livré', 'Indisponible', 'Désinscrit'];
const EXP = ['0-1 an', '1-3 ans', '3-5 ans', '5+ ans'];

function rand<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pickN<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length; i++) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
}

async function seedUsers() {
  await User.deleteMany({});
  const adminPass = await bcrypt.hash('admin123', 10);
  const managerPass = await bcrypt.hash('manager123', 10);
  await User.create([
    { email: 'admin@ccm.ai', password: adminPass, name: 'Admin Principal', role: 'admin', status: 'active' },
    { email: 'manager@ccm.ai', password: managerPass, name: 'Sarah Manager', role: 'manager', status: 'active' },
    { email: 'agent@ccm.ai', password: managerPass, name: 'Karim Agent', role: 'agent', status: 'active' },
    { email: 'viewer@ccm.ai', password: managerPass, name: 'Inès Viewer', role: 'viewer', status: 'active' },
  ]);
  console.log('✓ Seeded 4 users (admin@ccm.ai / admin123)');
}

async function seedCandidates() {
  await Candidate.deleteMany({});
  const docs: any[] = [];
  for (let i = 0; i < 800; i++) {
    const firstName = rand(FIRST_NAMES);
    const lastName = rand(LAST_NAMES);
    const source = rand(SOURCES);
    const status = rand(STATUSES);
    const livraisons = status === 'Livré' ? randInt(1, 5) : 0;
    docs.push({
      civility: Math.random() > 0.5 ? 'M.' : 'Mme',
      firstName,
      lastName,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${randInt(1, 999)}@email.com`,
      phone: `+33 6 ${randInt(10, 99)} ${randInt(10, 99)} ${randInt(10, 99)} ${randInt(10, 99)}`,
      age: randInt(20, 55),
      city: rand(CITIES),
      position: rand(POSITIONS),
      activity: rand(ACTIVITIES),
      operation: rand(OPERATIONS),
      languages: pickN(LANGUAGES, randInt(1, 3)),
      experienceYears: randInt(0, 15),
      experiencePoste: rand(EXP),
      experienceActivite: rand(EXP),
      experienceOperation: rand(EXP),
      testLinguistique: rand(['Non passé', 'Réussi', 'Échec', 'En attente']),
      score: randInt(20, 95),
      livraisons,
      source,
      status,
      lastActivityAt: new Date(Date.now() - randInt(0, 30) * 86400000),
      createdAt: new Date(Date.now() - randInt(0, 365) * 86400000),
    });
  }
  await Candidate.insertMany(docs);
  console.log(`✓ Seeded ${docs.length} candidates`);
}

async function seedCompanies() {
  await Company.deleteMany({});
  const names = ['TeleContact SARL', 'GlobalVoice SAS', 'CallPro Paris', 'MediaCall Lyon', 'Berlin Calls GmbH', 'London Call Centre Ltd', 'Madrid Telefonica SL', 'Tunis Call Center', 'Sfax Solutions', 'NordTelecom', 'SudContact', 'Atlantis Services', 'BrightCall', 'Vocalis SARL', 'ProContact', 'OfficeLink', 'HelpDesk Pro', 'CustomerFirst', 'SalesBoost', 'TelecomPlus', 'SupportHub'];
  const docs = names.map((name) => ({
    name,
    legalForm: rand(['SARL', 'SA', 'SAS', 'EURL']),
    industry: rand(['Télémarketing', 'Service Client', 'Télévente', 'Support IT', 'Conseil']),
    email: `contact@${name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
    phone: `+33 1 ${randInt(10, 99)} ${randInt(10, 99)} ${randInt(10, 99)} ${randInt(10, 99)}`,
    city: rand(CITIES),
    website: `https://www.${name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
    contactName: `${rand(FIRST_NAMES)} ${rand(LAST_NAMES)}`,
    contactRole: rand(['CEO', 'Directeur Commercial', 'Responsable RH', 'COO']),
    status: rand(['Actif', 'Actif', 'Actif', 'Prospect', 'Inactif', 'Suspendu']),
    contractType: rand(['Standard', 'Premium', 'Enterprise', 'Trial']),
    monthlyFee: randInt(500, 5000),
  }));
  await Company.insertMany(docs);
  console.log(`✓ Seeded ${docs.length} companies`);
  return docs;
}

async function seedProspects() {
  await Prospect.deleteMany({});
  const stages: ('new' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost')[] = ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
  const docs: any[] = [];
  for (let i = 0; i < 120; i++) {
    const firstName = rand(FIRST_NAMES);
    const lastName = rand(LAST_NAMES);
    const stage = rand(stages);
    docs.push({
      name: `${firstName} ${lastName}`,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@prospect.com`,
      phone: `+33 6 ${randInt(10, 99)} ${randInt(10, 99)} ${randInt(10, 99)} ${randInt(10, 99)}`,
      company: rand(['TeleContact', 'GlobalVoice', 'CallPro', 'MediaCall', 'BrightCall']),
      city: rand(CITIES),
      source: rand(['Site web', 'LinkedIn', 'Referral', 'Salon', 'Cold email', 'Facebook']),
      stage,
      value: randInt(500, 25000),
      currency: 'EUR',
      ownerName: rand(['Sarah Manager', 'Karim Agent', 'Inès Viewer']),
      nextAction: rand(['Appel de découverte', 'Envoi de proposition', 'Démo produit', 'Négociation finale', null]),
      nextActionAt: new Date(Date.now() + randInt(-7, 30) * 86400000),
      closedAt: stage === 'won' || stage === 'lost' ? new Date(Date.now() - randInt(0, 60) * 86400000) : undefined,
      createdAt: new Date(Date.now() - randInt(0, 180) * 86400000),
    });
  }
  await Prospect.insertMany(docs);
  console.log(`✓ Seeded ${docs.length} prospects`);
}

async function seedOrders(companies: any[]) {
  await Order.deleteMany({});
  const statuses = ['En attente', 'Confirmée', 'En cours', 'Livrée', 'Livrée', 'Annulée', 'En retard'];
  const types = ['Recrutement', 'Formation', 'Abonnement', 'Prestation', 'Conseil'];
  const docs: any[] = [];
  for (let i = 0; i < 60; i++) {
    const company = rand(companies);
    docs.push({
      reference: `CMD-${String(2026000 + i).padStart(7, '0')}`,
      companyId: company._id,
      companyName: company.name,
      amount: randInt(1000, 50000),
      currency: 'EUR',
      type: rand(types),
      status: rand(statuses as any),
      deliveryDate: new Date(Date.now() + randInt(-30, 60) * 86400000),
      createdAt: new Date(Date.now() - randInt(0, 180) * 86400000),
    });
  }
  await Order.insertMany(docs);
  console.log(`✓ Seeded ${docs.length} orders`);
  return docs;
}

async function seedPayments(companies: any[], orders: any[]) {
  await Payment.deleteMany({});
  const statuses = ['Payé', 'Payé', 'Payé', 'En attente', 'En retard', 'Partiel', 'Annulé', 'Remboursé'];
  const methods = ['Card', 'Bank transfer', 'SEPA', 'PayPal', 'Cheque', 'Cash'];
  const docs: any[] = [];
  for (let i = 0; i < 80; i++) {
    const order = rand(orders);
    const company = companies.find((c) => String(c._id) === String(order.companyId)) || rand(companies);
    const status = rand(statuses as any);
    docs.push({
      reference: `PAY-${String(2026000 + i).padStart(7, '0')}`,
      orderId: order._id,
      orderRef: order.reference,
      companyId: company._id,
      companyName: company.name,
      amount: order.amount,
      currency: 'EUR',
      method: rand(methods as any),
      status,
      dueDate: new Date(Date.now() + randInt(-60, 30) * 86400000),
      paidAt: status === 'Payé' ? new Date(Date.now() - randInt(0, 30) * 86400000) : undefined,
      createdAt: new Date(Date.now() - randInt(0, 180) * 86400000),
    });
  }
  await Payment.insertMany(docs);
  console.log(`✓ Seeded ${docs.length} payments`);
}

async function seedMarketingChannels() {
  await MarketingChannel.deleteMany({});
  const channels = [
    { name: 'Facebook Ads Recrutement', platform: 'Facebook' as const, spend: 12450, leads: 2243, conversions: 178 },
    { name: 'LinkedIn Premium', platform: 'LinkedIn' as const, spend: 8900, leads: 612, conversions: 94 },
    { name: 'Google Ads Search', platform: 'Google Ads' as const, spend: 6200, leads: 980, conversions: 87 },
    { name: 'Instagram Stories', platform: 'Instagram' as const, spend: 3400, leads: 760, conversions: 41 },
    { name: 'Email Nurturing', platform: 'Email' as const, spend: 850, leads: 1240, conversions: 156 },
    { name: 'Referral Programme', platform: 'Referral' as const, spend: 1200, leads: 412, conversions: 102 },
    { name: 'Trafic Direct', platform: 'Direct' as const, spend: 0, leads: 615, conversions: 88 },
  ];
  const docs = channels.map((c) => ({
    ...c,
    cpl: c.leads ? Number((c.spend / c.leads).toFixed(2)) : 0,
    cpa: c.conversions ? Number((c.spend / c.conversions).toFixed(2)) : 0,
    active: true,
  }));
  await MarketingChannel.insertMany(docs);
  console.log(`✓ Seeded ${docs.length} marketing channels`);
}

async function seedActivityLog() {
  await ActivityLog.deleteMany({});
  const entries = [
    { type: 'login', description: 'admin@ccm.ai s\'est connecté', userName: 'Admin Principal' },
    { type: 'create', entity: 'prospect', description: 'Nouveau prospect "Sarah Martin" créé', userName: 'Sarah Manager' },
    { type: 'update', entity: 'company', description: 'Mise à jour de TeleContact SARL', userName: 'Admin Principal' },
    { type: 'ai_chat', description: 'Q: Combien de candidats à Paris ?', userName: 'Admin Principal' },
    { type: 'create', entity: 'order', description: 'Commande CMD-2026001 créée', userName: 'Karim Agent' },
    { type: 'view', entity: 'dashboard', description: 'Consultation du cockpit', userName: 'Inès Viewer' },
    { type: 'update', entity: 'payment', description: 'Paiement PAY-2026012 marqué comme Payé', userName: 'Sarah Manager' },
    { type: 'system', description: 'Sauvegarde automatique de la base', userName: 'Système' },
  ];
  await ActivityLog.create(entries.map((e, i) => ({
    ...e,
    createdAt: new Date(Date.now() - i * 3600000),
  })));
  console.log(`✓ Seeded ${entries.length} activity logs`);
}

async function main() {
  await connectDB();
  console.log('🌱 Seeding database...');

  await seedUsers();
  await seedCandidates();
  const companies = await seedCompanies();
  await seedProspects();
  const orders = await seedOrders(companies);
  await seedPayments(companies, orders);
  await seedMarketingChannels();
  await seedActivityLog();

  console.log('\n✅ Seed complete!');
  console.log('   Login: admin@ccm.ai / admin123');
  console.log('   Or:    manager@ccm.ai / manager123');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
