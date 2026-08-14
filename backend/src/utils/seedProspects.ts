/**
 * seedProspects.ts — PRO v1.0
 * -----------------------------------------------------------------------------
 * Seeds the `prospects` MongoDB collection with 35 realistic Tunisian prospects
 * so the CRM Prospects dashboard shows real data instead of zeros.
 *
 * Coverage:
 *   • 6 stages represented (new, qualified, proposal, negotiation, won, lost)
 *   • 7 sources (Site web, Manuel, LinkedIn, Referral, Salon, Email, Facebook,
 *                Formulaire, Téléphone)
 *   • 12 Tunisian governorates (Tunis, Sousse, Sfax, Médenine, etc.)
 *   • Created dates spread across: today, 7j, 30j, 60j, 90j, 180j
 *   • CA prévisionnel values from 2k€ to 250k€ (some 0 for "new")
 *   • Won deals have closedAt set; lost deals have notes explaining why
 *   • Next actions + dates set for active pipeline
 *
 * RUN (from backend/ directory):
 *   npx ts-node-dev --transpile-only src/utils/seedProspects.ts
 *
 * ENV:
 *   MONGODB_URI=mongodb://localhost:27017/callcentermatch  (default)
 *
 * OPTIONS (env vars):
 *   SEED_MODE=append    → keep existing prospects, only add new ones (default)
 *   SEED_MODE=replace   → DELETE all existing prospects first, then insert
 * -----------------------------------------------------------------------------
 */
import mongoose from 'mongoose';
import { Schema } from 'mongoose';

const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/callcentermatch';

const SEED_MODE = process.env.SEED_MODE || 'append'; // or 'replace'

// Use a local schema (don't import the model — keeps the script self-contained)
const ProspectSchema = new Schema(
  {
    name: { type: String, required: true, index: true },
    email: { type: String, lowercase: true, trim: true, index: true },
    phone: { type: String, trim: true },
    company: { type: String },
    city: { type: String, default: 'Tunis' },
    source: { type: String, default: 'Site web' },
    stage: {
      type: String,
      enum: ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'],
      default: 'new',
      index: true,
    },
    value: { type: Number, default: 0 },
    currency: { type: String, default: 'EUR' },
    ownerName: { type: String },
    nextAction: { type: String },
    nextActionAt: { type: Date },
    closedAt: { type: Date },
    notes: { type: String },
  },
  { timestamps: true }
);

const Prospect = mongoose.model('Prospect', ProspectSchema);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const DAY = 86400000;
const now = Date.now();
const daysAgo = (n: number) => new Date(now - n * DAY);
const daysAhead = (n: number) => new Date(now + n * DAY);

// Force `createdAt` to a specific date (timestamps: true would override otherwise)
const withCreated = (createdAt: Date, doc: any) => ({ ...doc, createdAt, updatedAt: createdAt });

// ---------------------------------------------------------------------------
// 35 realistic Tunisian prospects — varied across all dimensions
// ---------------------------------------------------------------------------
type SeedDoc = {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  city: string;
  source: string;
  stage: 'new' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
  value: number;
  currency?: string;
  ownerName?: string;
  nextAction?: string;
  nextActionAt?: Date;
  closedAt?: Date;
  notes?: string;
};

const PROSPECTS: Array<{ doc: SeedDoc; createdAt: Date }> = [
  // ===== STAGE: new (6 prospects — recent, no value yet, awaiting first contact) =====
  {
    createdAt: daysAgo(0),
    doc: {
      name: 'Karim Ben Salah',
      email: 'k.bensalah@technosolutions.tn',
      phone: '+216 22 145 889',
      company: 'TechnoSolutions SARL',
      city: 'Tunis',
      source: 'Site web',
      stage: 'new',
      value: 0,
      ownerName: 'Équipe Sales',
      nextAction: 'Premier appel découverte',
      nextActionAt: daysAhead(1),
      notes: 'Demande de démo via formulaire site web. Société de dev logicielle, 25 employés.',
    },
  },
  {
    createdAt: daysAgo(1),
    doc: {
      name: 'Sophie Martin',
      email: 'sophie.martin@luxmobile.com',
      phone: '+216 71 902 113',
      company: 'LuxMobile Distribution',
      city: 'Ariana',
      source: 'Formulaire',
      stage: 'new',
      value: 0,
      nextAction: 'Qualifier le besoin',
      nextActionAt: daysAhead(2),
      notes: 'Lead entrant via landing page campagne Facebook Ads.',
    },
  },
  {
    createdAt: daysAgo(2),
    doc: {
      name: 'Mehdi Trabelsi',
      email: 'mehdi.trabelsi@gmail.com',
      phone: '+216 50 667 221',
      company: 'Freelance',
      city: 'Sousse',
      source: 'LinkedIn',
      stage: 'new',
      value: 0,
      nextAction: 'Envoyer plaquette commerciale',
      nextActionAt: daysAhead(1),
    },
  },
  {
    createdAt: daysAgo(3),
    doc: {
      name: 'Ines Kefi',
      email: 'ines.kefi@modastyle.tn',
      phone: '+216 98 223 445',
      company: 'ModaStyle E-commerce',
      city: 'Sfax',
      source: 'Facebook',
      stage: 'new',
      value: 0,
      nextAction: 'Appel téléphonique de qualification',
      nextActionAt: daysAhead(1),
    },
  },
  {
    createdAt: daysAgo(5),
    doc: {
      name: 'Olivia Dubois',
      email: 'o.dubois@frenchtechparis.com',
      phone: '+33 1 42 78 90 12',
      company: 'FrenchTech Paris',
      city: 'Tunis',
      source: 'Salon',
      stage: 'new',
      value: 0,
      nextAction: 'Planifier meeting visio',
      nextActionAt: daysAhead(3),
      notes: 'Rencontré au salon Tunisia Tech Days, carte de visite échangée.',
    },
  },
  {
    createdAt: daysAgo(6),
    doc: {
      name: 'Hamza Gharbi',
      email: 'h.gharbi@saharacomputing.tn',
      phone: '+216 71 558 992',
      company: 'Sahara Computing',
      city: 'Gabès',
      source: 'Manuel',
      stage: 'new',
      value: 0,
      ownerName: 'Équipe Sales',
      nextAction: 'Premier contact téléphonique',
      nextActionAt: daysAhead(2),
    },
  },

  // ===== STAGE: qualified (Contacté/Démo — 7 prospects, CA starting to materialize) =====
  {
    createdAt: daysAgo(8),
    doc: {
      name: 'Leila Bouazizi',
      email: 'leila.b@agromed.tn',
      phone: '+216 74 552 338',
      company: 'AgroMed Industries',
      city: 'Sousse',
      source: 'Site web',
      stage: 'qualified',
      value: 45000,
      ownerName: 'Sophie (Sales)',
      nextAction: 'Démo produit planifiée',
      nextActionAt: daysAhead(2),
      notes: 'Société agroalimentaire, 80 employés. Besoin CRM + facturation.',
    },
  },
  {
    createdAt: daysAgo(10),
    doc: {
      name: 'Marc Lefevre',
      email: 'marc@lefevre-consulting.fr',
      phone: '+33 6 12 34 56 78',
      company: 'Lefevre Consulting',
      city: 'Tunis',
      source: 'Referral',
      stage: 'qualified',
      value: 18000,
      nextAction: 'Démo en présentiel',
      nextActionAt: daysAhead(4),
      notes: 'Recommandé par client existant (TunisTech).',
    },
  },
  {
    createdAt: daysAgo(12),
    doc: {
      name: 'Fatima Zahra Ben Ammar',
      email: 'fz.benammar@medi Clinic.tn',
      phone: '+216 71 889 447',
      company: 'MediClinic Tunis',
      city: 'Tunis',
      source: 'LinkedIn',
      stage: 'qualified',
      value: 75000,
      nextAction: 'Réunion avec DG',
      nextActionAt: daysAhead(3),
    },
  },
  {
    createdAt: daysAgo(14),
    doc: {
      name: 'Youssef Aouni',
      email: 'y.aouni@construct-plus.tn',
      phone: '+216 22 998 554',
      company: 'ConstructPlus BTP',
      city: 'Sfax',
      source: 'Salon',
      stage: 'qualified',
      value: 60000,
      nextAction: 'Démo produit',
      nextActionAt: daysAhead(1),
    },
  },
  {
    createdAt: daysAgo(15),
    doc: {
      name: 'Claire Rousseau',
      email: 'claire.rousseau@french-export.fr',
      phone: '+33 4 91 22 33 44',
      company: 'French Export Conseil',
      city: 'Médenine',
      source: 'Email',
      stage: 'qualified',
      value: 22000,
      nextAction: 'Envoyer proposition préliminaire',
      nextActionAt: daysAhead(2),
    },
  },
  {
    createdAt: daysAgo(18),
    doc: {
      name: 'Slim Tlili',
      email: 's.tlili@pharmadistrib.tn',
      phone: '+216 75 667 112',
      company: 'PharmaDistrib TN',
      city: 'Monastir',
      source: 'Téléphone',
      stage: 'qualified',
      value: 38000,
      nextAction: 'Démo plateforme logistique',
      nextActionAt: daysAhead(5),
    },
  },
  {
    createdAt: daysAgo(20),
    doc: {
      name: 'Amina Jelassi',
      email: 'amina.j@startup-incub.tn',
      phone: '+216 24 556 778',
      company: 'Startup Incubator TN',
      city: 'Bizerte',
      source: 'Manuel',
      stage: 'qualified',
      value: 12000,
      nextAction: 'Suivi démo technique',
      nextActionAt: daysAhead(3),
    },
  },

  // ===== STAGE: proposal (Devis — 6 prospects, formal offers sent) =====
  {
    createdAt: daysAgo(25),
    doc: {
      name: 'Rania Mansour',
      email: 'r.mansour@technoPark.tn',
      phone: '+216 71 445 226',
      company: 'TechnoPark El Ghazala',
      city: 'Ariana',
      source: 'Site web',
      stage: 'proposal',
      value: 95000,
      ownerName: 'Sophie (Sales)',
      nextAction: 'Relance devis',
      nextActionAt: daysAhead(1),
      notes: 'Devis envoyé, en attente validation comité direction.',
    },
  },
  {
    createdAt: daysAgo(28),
    doc: {
      name: 'David Chen',
      email: 'david.chen@globaltech.cn',
      phone: '+86 21 5555 8888',
      company: 'GlobalTech Shanghai',
      city: 'Tunis',
      source: 'LinkedIn',
      stage: 'proposal',
      value: 125000,
      nextAction: 'Négociation prix',
      nextActionAt: daysAhead(2),
    },
  },
  {
    createdAt: daysAgo(30),
    doc: {
      name: 'Khalil Riahi',
      email: 'khalil.riahi@bankplus.tn',
      phone: '+216 71 889 555',
      company: 'BankPlus Financial Services',
      city: 'Tunis',
      source: 'Referral',
      stage: 'proposal',
      value: 180000,
      nextAction: 'Réunion validation finale',
      nextActionAt: daysAhead(3),
      notes: 'Gros deal — solution banking digital. Décision prévue sous 7j.',
    },
  },
  {
    createdAt: daysAgo(35),
    doc: {
      name: 'Marie Dupont',
      email: 'marie.dupont@bio-cosmetique.fr',
      phone: '+33 1 44 55 66 77',
      company: 'BioCosmétique Paris',
      city: 'Sousse',
      source: 'Salon',
      stage: 'proposal',
      value: 42000,
      nextAction: 'Présentation visio',
      nextActionAt: daysAhead(4),
    },
  },
  {
    createdAt: daysAgo(40),
    doc: {
      name: 'Nizar Hammami',
      email: 'nizar@hammamiconstruction.tn',
      phone: '+216 75 998 221',
      company: 'Hammami Construction',
      city: 'Mahdia',
      source: 'Site web',
      stage: 'proposal',
      value: 68000,
      nextAction: 'Attente retour client',
      nextActionAt: daysAhead(2),
    },
  },
  {
    createdAt: daysAgo(45),
    doc: {
      name: 'Sandra Lopez',
      email: 'sandra.lopez@ibero-tech.es',
      phone: '+34 91 222 33 44',
      company: 'IberoTech Madrid',
      city: 'Nabeul',
      source: 'Email',
      stage: 'proposal',
      value: 55000,
      nextAction: 'Suivi proposition commerciale',
      nextActionAt: daysAhead(3),
    },
  },

  // ===== STAGE: negotiation (6 prospects — final price/terms talks) =====
  {
    createdAt: daysAgo(50),
    doc: {
      name: 'Antoine Moreau',
      email: 'a.moreau@groupe-reunaute.fr',
      phone: '+33 1 56 78 90 12',
      company: 'Groupe Réunaute',
      city: 'Tunis',
      source: 'LinkedIn',
      stage: 'negotiation',
      value: 220000,
      ownerName: 'Karim (Senior Sales)',
      nextAction: 'Négociation conditions contractuelles',
      nextActionAt: daysAhead(2),
      notes: 'Très proche de la signature. Blocage sur clause SLA.',
    },
  },
  {
    createdAt: daysAgo(55),
    doc: {
      name: 'Bochra Sellami',
      email: 'bochra.sellami@tunisian-retail.tn',
      phone: '+216 71 332 117',
      company: 'Tunisian Retail Group',
      city: 'Sousse',
      source: 'Referral',
      stage: 'negotiation',
      value: 155000,
      nextAction: 'Réunion finale prix',
      nextActionAt: daysAhead(1),
    },
  },
  {
    createdAt: daysAgo(60),
    doc: {
      name: 'Pierre Garnier',
      email: 'p.garnier@logipro.fr',
      phone: '+33 4 78 22 33 44',
      company: 'LogiPro Logistics',
      city: 'Sfax',
      source: 'Salon',
      stage: 'negotiation',
      value: 88000,
      nextAction: 'Validation juridique',
      nextActionAt: daysAhead(3),
    },
  },
  {
    createdAt: daysAgo(65),
    doc: {
      name: 'Wassim Ben Jemaa',
      email: 'w.benjemaa@smartfactory.tn',
      phone: '+216 73 556 889',
      company: 'SmartFactory TN',
      city: 'Sousse',
      source: 'Site web',
      stage: 'negotiation',
      value: 110000,
      nextAction: 'Négociation prix final',
      nextActionAt: daysAhead(2),
    },
  },
  {
    createdAt: daysAgo(70),
    doc: {
      name: 'Isabelle Petit',
      email: 'i.petit@frenchmedical.fr',
      phone: '+33 1 42 88 99 00',
      company: 'French Medical Devices',
      city: 'Tunis',
      source: 'Email',
      stage: 'negotiation',
      value: 75000,
      nextAction: 'Préparation contrat',
      nextActionAt: daysAhead(4),
    },
  },
  {
    createdAt: daysAgo(75),
    doc: {
      name: 'Mohamed Ali Guediche',
      email: 'm.guediche@transport-med.tn',
      phone: '+216 76 558 220',
      company: 'Transport Med SA',
      city: 'Médenine',
      source: 'Manuel',
      stage: 'negotiation',
      value: 92000,
      nextAction: 'Signature contrat',
      nextActionAt: daysAhead(5),
    },
  },

  // ===== STAGE: won (5 prospects — closed deals, CA confirmed) =====
  {
    createdAt: daysAgo(80),
    doc: {
      name: 'Julie Bernard',
      email: 'j.bernard@french-medical.fr',
      phone: '+33 1 44 77 88 99',
      company: 'French Medical Group',
      city: 'Tunis',
      source: 'LinkedIn',
      stage: 'won',
      value: 145000,
      ownerName: 'Karim (Senior Sales)',
      closedAt: daysAgo(5),
      nextAction: 'Onboarding client',
      nextActionAt: daysAhead(7),
      notes: 'Contrat signé. Mise en production prévue dans 30j.',
    },
  },
  {
    createdAt: daysAgo(95),
    doc: {
      name: 'Oumaima Sassi',
      email: 'oumaima.sassi@digitalacademy.tn',
      phone: '+216 71 445 887',
      company: 'Digital Academy TN',
      city: 'Ariana',
      source: 'Site web',
      stage: 'won',
      value: 35000,
      closedAt: daysAgo(10),
      nextAction: 'Livraison plateforme',
      nextActionAt: daysAhead(14),
    },
  },
  {
    createdAt: daysAgo(110),
    doc: {
      name: 'Thomas Roux',
      email: 't.roux@construct-lyon.fr',
      phone: '+33 4 72 00 11 22',
      company: 'Construct Lyon',
      city: 'Sousse',
      source: 'Referral',
      stage: 'won',
      value: 88000,
      closedAt: daysAgo(20),
      nextAction: 'Support post-vente',
      nextActionAt: daysAhead(30),
    },
  },
  {
    createdAt: daysAgo(120),
    doc: {
      name: 'Anis Khelifi',
      email: 'anis.khelifi@agroexport.tn',
      phone: '+216 74 998 552',
      company: 'AgroExport TN',
      city: 'Sfax',
      source: 'Téléphone',
      stage: 'won',
      value: 250000,
      closedAt: daysAgo(15),
      nextAction: 'Audit infrastructure',
      nextActionAt: daysAhead(10),
      notes: 'Plus gros deal de l\'année. Solution ERP complète.',
    },
  },
  {
    createdAt: daysAgo(150),
    doc: {
      name: 'Camille Faure',
      email: 'c.faure@paris-digital.fr',
      phone: '+33 1 56 89 00 11',
      company: 'Paris Digital Agency',
      city: 'Tunis',
      source: 'Salon',
      stage: 'won',
      value: 52000,
      closedAt: daysAgo(45),
      nextAction: 'Renouvellement contrat annuel',
      nextActionAt: daysAhead(60),
    },
  },

  // ===== STAGE: lost (5 prospects — lost deals with reasons) =====
  {
    createdAt: daysAgo(85),
    doc: {
      name: 'François Lemaire',
      email: 'f.lemaire@competitor-tech.fr',
      phone: '+33 1 45 67 89 00',
      company: 'Competitor Tech',
      city: 'Tunis',
      source: 'LinkedIn',
      stage: 'lost',
      value: 65000,
      closedAt: daysAgo(20),
      notes: 'LOST: Prix trop élevé par rapport au concurrent. Client parti chez Salesforce.',
    },
  },
  {
    createdAt: daysAgo(100),
    doc: {
      name: 'Sabrine Khaldi',
      email: 's.khaldi@fastfood-chain.tn',
      phone: '+216 71 223 998',
      company: 'FastFood Chain TN',
      city: 'Sousse',
      source: 'Site web',
      stage: 'lost',
      value: 28000,
      closedAt: daysAgo(30),
      notes: 'LOST: Budget insuffisant. Recontacter dans 6 mois.',
    },
  },
  {
    createdAt: daysAgo(115),
    doc: {
      name: 'Paul Mercier',
      email: 'p.mercier@old-school.fr',
      phone: '+33 1 33 44 55 66',
      company: 'Old School Solutions',
      city: 'Nabeul',
      source: 'Email',
      stage: 'lost',
      value: 42000,
      closedAt: daysAgo(40),
      notes: 'LOST: Préfère solution interne. Pas de besoin réel identifié.',
    },
  },
  {
    createdAt: daysAgo(130),
    doc: {
      name: 'Hatem Zribi',
      email: 'hatem.zribi@textile-med.tn',
      phone: '+216 73 558 119',
      company: 'Textile Med Industries',
      city: 'Monastir',
      source: 'Salon',
      stage: 'lost',
      value: 55000,
      closedAt: daysAgo(50),
      notes: 'LOST: Timing défavorable. Reporté à 2026.',
    },
  },
  {
    createdAt: daysAgo(160),
    doc: {
      name: 'Sophie Lefebvre',
      email: 's.lefebvre@french-retail.fr',
      phone: '+33 1 78 90 11 22',
      company: 'French Retail Group',
      city: 'Sfax',
      source: 'Referral',
      stage: 'lost',
      value: 95000,
      closedAt: daysAgo(80),
      notes: 'LOST: Décision interne reportée sine die.',
    },
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('🌱 Starting prospect seed...');
  console.log('   MONGODB_URI:', MONGODB_URI.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@'));
  console.log('   SEED_MODE  :', SEED_MODE);

  await mongoose.connect(MONGODB_URI);
  mongoose.set('strictQuery', true);
  console.log('✅ Connected to MongoDB');

  if (SEED_MODE === 'replace') {
    const del = await Prospect.deleteMany({});
    console.log(`🗑️  Deleted ${del.deletedCount} existing prospects`);
  }

  const existing = await Prospect.countDocuments({});
  console.log(`📊 Existing prospects in DB: ${existing}`);

  // Insert one by one so we can override createdAt via $setOnInsert-style hack
  // (Mongoose timestamps:true overrides createdAt on insertMany — so we use
  //  bulkWrite with updateOne + upsert + setOnInsert instead.)
  const ops = PROSPECTS.map(({ doc, createdAt }) => ({
    updateOne: {
      filter: { email: doc.email || `_${doc.name}_${Math.random().toString(36).slice(2)}@seed.local` },
      update: {
        $set: { ...doc, updatedAt: createdAt },
        $setOnInsert: { createdAt },
      },
      upsert: true,
    },
  }));

  const result = await Prospect.bulkWrite(ops);
  const inserted = result.upsertedCount || 0;
  const modified = result.modifiedCount || 0;
  console.log(`✅ Done — ${inserted} new prospects inserted, ${modified} updated`);

  // Verify distribution
  const pipeline = await Prospect.aggregate([
    { $group: { _id: '$stage', count: { $sum: 1 }, value: { $sum: '$value' } } },
    { $sort: { _id: 1 } },
  ]);
  console.log('\n📊 Stage distribution after seed:');
  for (const s of pipeline as any[]) {
    console.log(`   ${String(s._id).padEnd(12)} → ${String(s.count).padStart(3)} prospects · ${(s.value || 0).toLocaleString('fr-FR')} €`);
  }

  const totalValue = await Prospect.aggregate([
    { $match: { stage: { $in: ['new', 'qualified', 'proposal', 'negotiation'] } } },
    { $group: { _id: null, total: { $sum: '$value' } } },
  ]);
  console.log(`\n💰 CA prévisionnel (active pipeline): ${(totalValue[0]?.total || 0).toLocaleString('fr-FR')} €`);

  const wonValue = await Prospect.aggregate([
    { $match: { stage: 'won' } },
    { $group: { _id: null, total: { $sum: '$value' } } },
  ]);
  console.log(`🏆 CA gagné (won): ${(wonValue[0]?.total || 0).toLocaleString('fr-FR')} €`);

  await mongoose.disconnect();
  console.log('\n🔌 Disconnected. CRM Prospects dashboard should now show real data.');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
