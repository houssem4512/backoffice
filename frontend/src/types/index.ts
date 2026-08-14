export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface PagedList<T> {
  data: T[];
  total: number;
  page?: number;
  limit?: number;
}

export interface Candidate {
  _id?: string;
  id?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  city?: string;
  city_name?: string;
  gender?: string;
  age?: number;
  status?: string;
  status_name?: string;
  source?: string;
  languages?: string[] | string;
  created_at?: string;
  position?: string;
  experience?: string;
  activity?: string;
  deliveries?: number;
  score?: number;
  last_activity?: string;
  [k: string]: any;
}

export interface Company {
  _id?: string;
  id?: string;
  name?: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  city?: string;
  status?: string;
  sector?: string;
  orders_count?: number;
  total_revenue?: number;
  last_activity?: string;
  created_at?: string;
  [k: string]: any;
}

export interface Prospect {
  _id?: string;
  id?: string;
  contact_name?: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  company_name?: string;
  source?: string;
  status?: string;
  stage?: string;
  city?: string;
  offer?: string;
  offer_label?: string;
  ca_potential?: number;
  potential_revenue?: number;
  next_action?: string;
  next_action_date?: string;
  created_at?: string;
  [k: string]: any;
}

export interface Order {
  _id?: string;
  id?: string;
  order_number?: string;
  reference?: string;
  company_name?: string;
  client_name?: string;
  status?: string;
  leads_target?: number;
  leads_delivered?: number;
  amount?: number;
  total_amount?: number;
  created_at?: string;
  expected_delivery?: string;
  payment_status?: string;
  payment_method?: string;
  progress?: number;
  responsible?: string;
  [k: string]: any;
}

export interface Payment {
  _id?: string;
  id?: string;
  order_number?: string;
  order_id?: string;
  company_name?: string;
  client_name?: string;
  amount?: number;
  amount_paid?: number;
  paid_amount?: number;
  remaining?: number;
  due_date?: string;
  status?: string;
  method?: string;
  payment_method?: string;
  created_at?: string;
  [k: string]: any;
}

export interface User {
  _id?: string;
  id?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  role?: string;
  status?: string;
  created_at?: string;
  last_login?: string;
  [k: string]: any;
}
