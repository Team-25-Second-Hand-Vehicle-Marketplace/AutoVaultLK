import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';

config({ path: '../.env' });

/**
 * Seeds auth.users -> auth.dealer_profiles -> marketplace.vehicles.
 *
 * Crosses into the `auth` schema, which marketplace does not own. That is
 * acceptable here only because this script runs as the migration-runner role
 * (DATABASE_URL), not a scoped service role. Application code must never do
 * this — see database/src/grants.sql.
 *
 * The distribution is deliberately shaped to exercise the edge cases this
 * feature was built around:
 *   - ~25% registration_year NULL  -> Decision 3: these rows must NOT vanish
 *                                     from a year-filtered search
 *   - ~20% sparse/empty specs      -> the `@>` containment path and the
 *                                     "spec key absent" path
 *   - mixed statuses               -> proves the status='LIVE' gate excludes
 *   - 3 VERIFIED / 1 PENDING /
 *     1 REJECTED dealer            -> makes verifiedDealersOnly testable
 *
 * Idempotent: ON CONFLICT DO NOTHING. Safe to re-run.
 */

const DEALERS = [
  { email: 'auto.lanka@example.com',    name: 'Auto Lanka',        company: 'Auto Lanka (Pvt) Ltd',   city: 'Colombo',    status: 'VERIFIED', type: 'business'   },
  { email: 'kandy.motors@example.com',  name: 'Kandy Motors',      company: 'Kandy Motors',           city: 'Kandy',      status: 'VERIFIED', type: 'business'   },
  { email: 'nimal.perera@example.com',  name: 'Nimal Perera',      company: 'Nimal Auto Traders',     city: 'Galle',      status: 'VERIFIED', type: 'individual' },
  { email: 'south.wheels@example.com',  name: 'Southern Wheels',   company: 'Southern Wheels',        city: 'Matara',     status: 'PENDING',  type: 'business'   },
  { email: 'quick.deals@example.com',   name: 'Quick Deals',       company: 'Quick Deals Auto',       city: 'Negombo',    status: 'REJECTED', type: 'individual' },
];

type V = {
  type: string; make: string; model: string; year: number;
  regYear: number | null;          // null => Decision 3 test row
  price: number; mileage: number;
  fuel: string | null; trans: string | null;
  city: string; district: string;
  status: string;
  specs: Record<string, unknown>;  // {} => sparse-specs test row
  desc: string | null;
};

const VEHICLES: V[] = [
  // ---- CAR (LIVE, full specs) ----
  { type:'CAR', make:'Toyota', model:'Aqua', year:2017, regYear:2018, price:8500000, mileage:62000, fuel:'HYBRID', trans:'AUTOMATIC', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'HATCHBACK',seats:5,doors:5,drive_type:'FWD'}, desc:'Fuel efficient hybrid, well maintained, full option with reverse camera.' },
  { type:'CAR', make:'Toyota', model:'Axio', year:2016, regYear:2017, price:9200000, mileage:78000, fuel:'PETROL', trans:'CVT', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'SEDAN',seats:5,doors:4,drive_type:'FWD'}, desc:'Spacious family sedan, comfortable ride, single owner.' },
  { type:'CAR', make:'Toyota', model:'Vitz', year:2015, regYear:null, price:6800000, mileage:95000, fuel:'PETROL', trans:'AUTOMATIC', city:'Kandy', district:'Kandy', status:'LIVE', specs:{body_type:'HATCHBACK',seats:5,doors:5}, desc:'Compact city car, easy to park, economical.' },
  { type:'CAR', make:'Toyota', model:'Premio', year:2014, regYear:2015, price:11500000, mileage:112000, fuel:'PETROL', trans:'AUTOMATIC', city:'Galle', district:'Galle', status:'LIVE', specs:{body_type:'SEDAN',seats:5,doors:4,sunroof:true}, desc:'Luxury sedan, leather interior, sunroof.' },
  { type:'CAR', make:'Toyota', model:'Corolla', year:2012, regYear:null, price:7200000, mileage:145000, fuel:'PETROL', trans:'MANUAL', city:'Matara', district:'Matara', status:'LIVE', specs:{body_type:'SEDAN',seats:5,doors:4}, desc:'Reliable workhorse, new tyres.' },
  { type:'CAR', make:'Toyota', model:'Prius', year:2013, regYear:2014, price:7900000, mileage:132000, fuel:'HYBRID', trans:'CVT', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'HATCHBACK',seats:5,doors:5}, desc:'Excellent mileage, hybrid battery recently replaced.' },
  { type:'CAR', make:'Honda', model:'Fit', year:2016, regYear:2017, price:8100000, mileage:71000, fuel:'HYBRID', trans:'CVT', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'HATCHBACK',seats:5,doors:5}, desc:'Sporty handling, agile and fun to drive.' },
  { type:'CAR', make:'Honda', model:'Civic', year:2018, regYear:2019, price:15500000, mileage:42000, fuel:'PETROL', trans:'CVT', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'SEDAN',seats:5,doors:4,sunroof:true,airbags:6}, desc:'Performance sedan, turbo, firm ride, supportive seats.' },
  { type:'CAR', make:'Honda', model:'Grace', year:2015, regYear:null, price:8800000, mileage:88000, fuel:'HYBRID', trans:'CVT', city:'Kurunegala', district:'Kurunegala', status:'LIVE', specs:{body_type:'SEDAN',seats:5,doors:4}, desc:null },
  { type:'CAR', make:'Suzuki', model:'Alto', year:2019, regYear:2019, price:3900000, mileage:35000, fuel:'PETROL', trans:'MANUAL', city:'Gampaha', district:'Gampaha', status:'LIVE', specs:{body_type:'HATCHBACK',seats:4,doors:5}, desc:'Budget friendly, low running cost, ideal first car.' },
  { type:'CAR', make:'Suzuki', model:'Wagon R', year:2017, regYear:2018, price:5400000, mileage:58000, fuel:'HYBRID', trans:'AUTOMATIC', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'HATCHBACK',seats:5,doors:5}, desc:'Tall boy design, very spacious cabin for its size.' },
  { type:'CAR', make:'Suzuki', model:'Swift', year:2018, regYear:null, price:6200000, mileage:49000, fuel:'PETROL', trans:'AUTOMATIC', city:'Negombo', district:'Gampaha', status:'LIVE', specs:{body_type:'HATCHBACK',seats:5,doors:5}, desc:'Sporty hatch, responsive steering.' },
  { type:'CAR', make:'Nissan', model:'Leaf', year:2018, regYear:2019, price:9800000, mileage:44000, fuel:'ELECTRIC', trans:'AUTOMATIC', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'HATCHBACK',seats:5,doors:5}, desc:'Full electric, zero fuel cost, quiet and smooth.' },
  { type:'CAR', make:'Nissan', model:'March', year:2014, regYear:null, price:4300000, mileage:105000, fuel:'PETROL', trans:'AUTOMATIC', city:'Kandy', district:'Kandy', status:'LIVE', specs:{}, desc:'Small hatchback in good condition.' },
  { type:'CAR', make:'Nissan', model:'Sunny', year:2011, regYear:2012, price:4900000, mileage:168000, fuel:'PETROL', trans:'MANUAL', city:'Jaffna', district:'Jaffna', status:'LIVE', specs:{body_type:'SEDAN',seats:5}, desc:null },
  { type:'CAR', make:'Mitsubishi', model:'Lancer', year:2010, regYear:null, price:5600000, mileage:182000, fuel:'PETROL', trans:'MANUAL', city:'Anuradhapura', district:'Anuradhapura', status:'LIVE', specs:{body_type:'SEDAN',seats:5,doors:4}, desc:'Classic sporty sedan, well kept.' },
  { type:'CAR', make:'Hyundai', model:'Accent', year:2013, regYear:2014, price:4700000, mileage:124000, fuel:'PETROL', trans:'AUTOMATIC', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'SEDAN',seats:5,doors:4}, desc:null },
  { type:'CAR', make:'Hyundai', model:'i10', year:2016, regYear:2016, price:4100000, mileage:67000, fuel:'PETROL', trans:'MANUAL', city:'Ratnapura', district:'Ratnapura', status:'LIVE', specs:{body_type:'HATCHBACK',seats:5,doors:5}, desc:'Compact and economical.' },
  { type:'CAR', make:'Micro', model:'Panda', year:2015, regYear:null, price:2600000, mileage:89000, fuel:'PETROL', trans:'MANUAL', city:'Kurunegala', district:'Kurunegala', status:'LIVE', specs:{}, desc:null },
  { type:'CAR', make:'Perodua', model:'Viva', year:2012, regYear:2013, price:2200000, mileage:134000, fuel:'PETROL', trans:'MANUAL', city:'Badulla', district:'Badulla', status:'LIVE', specs:{body_type:'HATCHBACK',seats:4}, desc:'Very economical small car.' },
  { type:'CAR', make:'Mercedes-Benz', model:'C200', year:2017, regYear:2018, price:24500000, mileage:52000, fuel:'PETROL', trans:'AUTOMATIC', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'SEDAN',seats:5,doors:4,sunroof:true,airbags:8}, desc:'Luxury German sedan, premium leather, panoramic sunroof.' },
  { type:'CAR', make:'BMW', model:'320i', year:2016, regYear:null, price:21000000, mileage:61000, fuel:'PETROL', trans:'AUTOMATIC', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'SEDAN',seats:5,doors:4,sunroof:true}, desc:'Sporty executive sedan, rear wheel drive, excellent handling.' },
  { type:'CAR', make:'Audi', model:'A4', year:2015, regYear:2016, price:18500000, mileage:74000, fuel:'PETROL', trans:'AUTOMATIC', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'SEDAN',seats:5,doors:4}, desc:'Quattro all wheel drive, refined and comfortable.' },
  { type:'CAR', make:'Mazda', model:'Demio', year:2016, regYear:2017, price:6900000, mileage:63000, fuel:'DIESEL', trans:'AUTOMATIC', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'HATCHBACK',seats:5,doors:5}, desc:'Skyactiv diesel, great torque and economy.' },
  { type:'CAR', make:'Kia', model:'Picanto', year:2018, regYear:null, price:4600000, mileage:38000, fuel:'PETROL', trans:'AUTOMATIC', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'HATCHBACK',seats:5,doors:5}, desc:null },

  // ---- SUV ----
  { type:'SUV', make:'Toyota', model:'Land Cruiser', year:2019, regYear:2020, price:45000000, mileage:38000, fuel:'DIESEL', trans:'AUTOMATIC', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'SUV',seats:7,doors:5,drive_type:'4WD',sunroof:true,airbags:8}, desc:'Flagship 4WD, off road capable, luxury interior, seven seats.' },
  { type:'SUV', make:'Toyota', model:'CHR', year:2018, regYear:2019, price:14500000, mileage:47000, fuel:'HYBRID', trans:'CVT', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'SUV',seats:5,doors:5,drive_type:'FWD'}, desc:'Stylish crossover, coupe like roofline, hybrid economy.' },
  { type:'SUV', make:'Toyota', model:'Prado', year:2015, regYear:null, price:32000000, mileage:98000, fuel:'DIESEL', trans:'AUTOMATIC', city:'Kandy', district:'Kandy', status:'LIVE', specs:{body_type:'SUV',seats:7,doors:5,drive_type:'4WD'}, desc:'Rugged and reliable, seven seater, excellent for hill country.' },
  { type:'SUV', make:'Honda', model:'Vezel', year:2017, regYear:2018, price:13200000, mileage:55000, fuel:'HYBRID', trans:'CVT', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'SUV',seats:5,doors:5,drive_type:'FWD',sunroof:true}, desc:'Popular compact SUV, spacious boot, panoramic roof.' },
  { type:'SUV', make:'Honda', model:'CR-V', year:2016, regYear:null, price:16800000, mileage:82000, fuel:'PETROL', trans:'CVT', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'SUV',seats:5,doors:5,drive_type:'AWD'}, desc:'Comfortable family SUV, all wheel drive.' },
  { type:'SUV', make:'Nissan', model:'X-Trail', year:2017, regYear:2018, price:15200000, mileage:69000, fuel:'HYBRID', trans:'CVT', city:'Gampaha', district:'Gampaha', status:'LIVE', specs:{body_type:'SUV',seats:7,doors:5,drive_type:'AWD'}, desc:'Seven seat SUV, versatile and practical.' },
  { type:'SUV', make:'Mitsubishi', model:'Montero', year:2014, regYear:2015, price:19500000, mileage:118000, fuel:'DIESEL', trans:'AUTOMATIC', city:'Kandy', district:'Kandy', status:'LIVE', specs:{body_type:'SUV',seats:7,doors:5,drive_type:'4WD'}, desc:'Tough off roader, seven seats, strong diesel engine.' },
  { type:'SUV', make:'Mitsubishi', model:'Outlander', year:2018, regYear:null, price:17200000, mileage:51000, fuel:'HYBRID', trans:'AUTOMATIC', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'SUV',seats:5,doors:5,drive_type:'AWD'}, desc:'Plug in hybrid, quiet and refined.' },
  { type:'SUV', make:'Suzuki', model:'Vitara', year:2017, regYear:2018, price:9600000, mileage:64000, fuel:'PETROL', trans:'AUTOMATIC', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'SUV',seats:5,doors:5,drive_type:'FWD'}, desc:'Compact crossover, easy to drive.' },
  { type:'SUV', make:'Hyundai', model:'Tucson', year:2016, regYear:2017, price:12800000, mileage:76000, fuel:'DIESEL', trans:'AUTOMATIC', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'SUV',seats:5,doors:5}, desc:null },
  { type:'SUV', make:'Mahindra', model:'Scorpio', year:2015, regYear:null, price:7400000, mileage:126000, fuel:'DIESEL', trans:'MANUAL', city:'Anuradhapura', district:'Anuradhapura', status:'LIVE', specs:{body_type:'SUV',seats:7,doors:5,drive_type:'RWD'}, desc:'Affordable seven seater, good ground clearance.' },
  { type:'SUV', make:'Land Rover', model:'Discovery', year:2016, regYear:2017, price:38000000, mileage:71000, fuel:'DIESEL', trans:'AUTOMATIC', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'SUV',seats:7,doors:5,drive_type:'4WD',sunroof:true,airbags:8}, desc:'Premium British SUV, air suspension, luxurious.' },
  { type:'SUV', make:'Suzuki', model:'Jimny', year:2020, regYear:2020, price:11500000, mileage:22000, fuel:'PETROL', trans:'MANUAL', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'SUV',seats:4,doors:3,drive_type:'4WD'}, desc:'Iconic small 4x4, brilliant off road, retro styling.' },

  // ---- VAN ----
  { type:'VAN', make:'Toyota', model:'HiAce', year:2016, regYear:2017, price:16500000, mileage:142000, fuel:'DIESEL', trans:'MANUAL', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'MINIVAN',seats:14,doors:4}, desc:'High roof van, ideal for tours and staff transport.' },
  { type:'VAN', make:'Toyota', model:'Noah', year:2015, regYear:null, price:12800000, mileage:98000, fuel:'PETROL', trans:'CVT', city:'Kandy', district:'Kandy', status:'LIVE', specs:{body_type:'MINIVAN',seats:8,doors:5}, desc:'Family van, dual sliding doors, comfortable.' },
  { type:'VAN', make:'Toyota', model:'Townace', year:2013, regYear:2014, price:9200000, mileage:156000, fuel:'DIESEL', trans:'MANUAL', city:'Galle', district:'Galle', status:'LIVE', specs:{body_type:'MINIVAN',seats:7}, desc:null },
  { type:'VAN', make:'Nissan', model:'Caravan', year:2014, regYear:null, price:11200000, mileage:167000, fuel:'DIESEL', trans:'MANUAL', city:'Negombo', district:'Gampaha', status:'LIVE', specs:{}, desc:'Reliable commercial van.' },
  { type:'VAN', make:'Suzuki', model:'Every', year:2018, regYear:2018, price:5800000, mileage:52000, fuel:'PETROL', trans:'AUTOMATIC', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'MINIVAN',seats:4}, desc:'Small van, great for city deliveries.' },
  { type:'VAN', make:'Honda', model:'Freed', year:2016, regYear:2017, price:10400000, mileage:73000, fuel:'HYBRID', trans:'CVT', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'MINIVAN',seats:7,doors:5}, desc:'Compact seven seater, hybrid, sliding doors.' },
  { type:'VAN', make:'Mercedes-Benz', model:'Sprinter', year:2017, regYear:null, price:22000000, mileage:112000, fuel:'DIESEL', trans:'MANUAL', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'MINIVAN',seats:16}, desc:'Large capacity van, well maintained fleet vehicle.' },

  // ---- BIKE ----
  { type:'BIKE', make:'Bajaj', model:'Pulsar', year:2019, regYear:2019, price:520000, mileage:28000, fuel:'PETROL', trans:'MANUAL', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'MOTORBIKE',engine_class:'150cc'}, desc:'Popular sporty commuter bike, good pickup.' },
  { type:'BIKE', make:'Bajaj', model:'CT100', year:2020, regYear:null, price:310000, mileage:19000, fuel:'PETROL', trans:'MANUAL', city:'Kurunegala', district:'Kurunegala', status:'LIVE', specs:{body_type:'MOTORBIKE'}, desc:'Economical daily ride.' },
  { type:'BIKE', make:'TVS', model:'Apache', year:2018, regYear:2019, price:480000, mileage:34000, fuel:'PETROL', trans:'MANUAL', city:'Kandy', district:'Kandy', status:'LIVE', specs:{body_type:'MOTORBIKE',engine_class:'160cc'}, desc:'Racing inspired, agile handling.' },
  { type:'BIKE', make:'TVS', model:'Ntorq', year:2021, regYear:2021, price:450000, mileage:12000, fuel:'PETROL', trans:'AUTOMATIC', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'SCOOTER'}, desc:'Sporty scooter, digital console, very convenient.' },
  { type:'BIKE', make:'Honda', model:'Dio', year:2020, regYear:null, price:395000, mileage:16000, fuel:'PETROL', trans:'AUTOMATIC', city:'Gampaha', district:'Gampaha', status:'LIVE', specs:{body_type:'SCOOTER'}, desc:'Lightweight scooter, easy for city commuting.' },
  { type:'BIKE', make:'Yamaha', model:'FZ', year:2019, regYear:2020, price:610000, mileage:24000, fuel:'PETROL', trans:'MANUAL', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'MOTORBIKE',engine_class:'150cc'}, desc:'Muscular street bike, strong build quality.' },
  { type:'BIKE', make:'Yamaha', model:'R15', year:2021, regYear:2021, price:1150000, mileage:9000, fuel:'PETROL', trans:'MANUAL', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'MOTORBIKE',engine_class:'155cc'}, desc:'Full fairing sports bike, track inspired riding position.' },
  { type:'BIKE', make:'KTM', model:'Duke 200', year:2020, regYear:null, price:1280000, mileage:14000, fuel:'PETROL', trans:'MANUAL', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'MOTORBIKE',engine_class:'200cc'}, desc:'Aggressive naked bike, brilliant performance.' },
  { type:'BIKE', make:'Hero', model:'Splendor', year:2018, regYear:2018, price:285000, mileage:41000, fuel:'PETROL', trans:'MANUAL', city:'Jaffna', district:'Jaffna', status:'LIVE', specs:{}, desc:null },
  { type:'BIKE', make:'Suzuki', model:'Gixxer', year:2019, regYear:2020, price:560000, mileage:27000, fuel:'PETROL', trans:'MANUAL', city:'Matara', district:'Matara', status:'LIVE', specs:{body_type:'MOTORBIKE',engine_class:'155cc'}, desc:'Smooth engine, comfortable for long rides.' },

  // ---- THREE_WHEELER ----
  { type:'THREE_WHEELER', make:'Bajaj', model:'RE', year:2018, regYear:2018, price:850000, mileage:68000, fuel:'PETROL', trans:'MANUAL', city:'Colombo', district:'Colombo', status:'LIVE', specs:{seats:4}, desc:'Four stroke three wheeler, good condition, hire ready.' },
  { type:'THREE_WHEELER', make:'Bajaj', model:'RE', year:2020, regYear:null, price:1150000, mileage:32000, fuel:'PETROL', trans:'MANUAL', city:'Kandy', district:'Kandy', status:'LIVE', specs:{seats:4}, desc:'Low mileage, well maintained.' },
  { type:'THREE_WHEELER', make:'Piaggio', model:'Ape', year:2017, regYear:2017, price:720000, mileage:81000, fuel:'DIESEL', trans:'MANUAL', city:'Galle', district:'Galle', status:'LIVE', specs:{seats:4}, desc:null },
  { type:'THREE_WHEELER', make:'TVS', model:'King', year:2019, regYear:null, price:980000, mileage:45000, fuel:'PETROL', trans:'MANUAL', city:'Negombo', district:'Gampaha', status:'LIVE', specs:{}, desc:'Spacious passenger three wheeler.' },
  { type:'THREE_WHEELER', make:'Mahindra', model:'Alfa', year:2016, regYear:2016, price:650000, mileage:94000, fuel:'DIESEL', trans:'MANUAL', city:'Anuradhapura', district:'Anuradhapura', status:'LIVE', specs:{seats:4}, desc:'Cargo carrier, strong load capacity.' },

  // ---- PICKUP ----
  { type:'PICKUP', make:'Toyota', model:'Hilux', year:2018, regYear:2019, price:23500000, mileage:78000, fuel:'DIESEL', trans:'MANUAL', city:'Colombo', district:'Colombo', status:'LIVE', specs:{body_type:'PICKUP',seats:5,doors:4,drive_type:'4WD'}, desc:'Double cab, legendary durability, 4WD.' },
  { type:'PICKUP', make:'Nissan', model:'Navara', year:2017, regYear:null, price:19800000, mileage:92000, fuel:'DIESEL', trans:'AUTOMATIC', city:'Kandy', district:'Kandy', status:'LIVE', specs:{body_type:'PICKUP',seats:5,doors:4,drive_type:'4WD'}, desc:'Comfortable pickup, car like ride.' },
  { type:'PICKUP', make:'Isuzu', model:'D-Max', year:2016, regYear:2017, price:17500000, mileage:108000, fuel:'DIESEL', trans:'MANUAL', city:'Kurunegala', district:'Kurunegala', status:'LIVE', specs:{body_type:'PICKUP',seats:5,drive_type:'4WD'}, desc:'Workhorse pickup, strong chassis.' },
  { type:'PICKUP', make:'Mitsubishi', model:'L200', year:2015, regYear:null, price:14200000, mileage:135000, fuel:'DIESEL', trans:'MANUAL', city:'Badulla', district:'Badulla', status:'LIVE', specs:{body_type:'PICKUP',seats:5}, desc:null },
  { type:'PICKUP', make:'Mahindra', model:'Bolero', year:2017, regYear:2018, price:6800000, mileage:87000, fuel:'DIESEL', trans:'MANUAL', city:'Ratnapura', district:'Ratnapura', status:'LIVE', specs:{body_type:'PICKUP',seats:5}, desc:'Affordable utility pickup.' },

  // ---- LORRY ----
  { type:'LORRY', make:'Isuzu', model:'Elf', year:2014, regYear:2015, price:12500000, mileage:187000, fuel:'DIESEL', trans:'MANUAL', city:'Colombo', district:'Colombo', status:'LIVE', specs:{seats:3,load_capacity_kg:3000}, desc:'Reliable freight carrier, new body built.' },
  { type:'LORRY', make:'Mitsubishi', model:'Canter', year:2013, regYear:null, price:10800000, mileage:212000, fuel:'DIESEL', trans:'MANUAL', city:'Gampaha', district:'Gampaha', status:'LIVE', specs:{seats:3}, desc:'Workhorse lorry, well serviced.' },
  { type:'LORRY', make:'Tata', model:'Ace', year:2018, regYear:2018, price:3200000, mileage:76000, fuel:'DIESEL', trans:'MANUAL', city:'Kurunegala', district:'Kurunegala', status:'LIVE', specs:{seats:2}, desc:'Mini lorry, ideal for small businesses.' },
  { type:'LORRY', make:'Foton', model:'Aumark', year:2016, regYear:null, price:8500000, mileage:143000, fuel:'DIESEL', trans:'MANUAL', city:'Colombo', district:'Colombo', status:'LIVE', specs:{}, desc:null },
  { type:'LORRY', make:'Ashok Leyland', model:'Dost', year:2017, regYear:2017, price:4100000, mileage:98000, fuel:'DIESEL', trans:'MANUAL', city:'Jaffna', district:'Jaffna', status:'LIVE', specs:{seats:2}, desc:'Light commercial vehicle, economical.' },

  // ---- TRUCK ----
  { type:'TRUCK', make:'Isuzu', model:'Forward', year:2012, regYear:2013, price:15500000, mileage:245000, fuel:'DIESEL', trans:'MANUAL', city:'Colombo', district:'Colombo', status:'LIVE', specs:{seats:3,load_capacity_kg:8000}, desc:'Heavy duty truck, strong engine, long distance ready.' },
  { type:'TRUCK', make:'Ashok Leyland', model:'Viking', year:2015, regYear:null, price:11200000, mileage:198000, fuel:'DIESEL', trans:'MANUAL', city:'Anuradhapura', district:'Anuradhapura', status:'LIVE', specs:{}, desc:null },

  // ---- BUS ----
  { type:'BUS', make:'Ashok Leyland', model:'Viking', year:2016, regYear:2016, price:18500000, mileage:176000, fuel:'DIESEL', trans:'MANUAL', city:'Kandy', district:'Kandy', status:'LIVE', specs:{seats:54}, desc:'Passenger bus, route permit available.' },
  { type:'BUS', make:'Tata', model:'Indica', year:2014, regYear:null, price:9800000, mileage:224000, fuel:'DIESEL', trans:'MANUAL', city:'Kurunegala', district:'Kurunegala', status:'LIVE', specs:{seats:32}, desc:'Mid size bus, good for school transport.' },
  { type:'BUS', make:'Isuzu', model:'Forward', year:2013, regYear:2014, price:13500000, mileage:203000, fuel:'DIESEL', trans:'MANUAL', city:'Galle', district:'Galle', status:'LIVE', specs:{seats:45}, desc:null },

  // ---- TRACTOR ----
  { type:'TRACTOR', make:'John Deere', model:'5045D', year:2018, regYear:2018, price:4800000, mileage:3200, fuel:'DIESEL', trans:'MANUAL', city:'Anuradhapura', district:'Anuradhapura', status:'LIVE', specs:{drive_type:'4WD'}, desc:'Agricultural tractor, low hours, excellent condition.' },
  { type:'TRACTOR', make:'Kubota', model:'L3408', year:2019, regYear:null, price:3900000, mileage:1800, fuel:'DIESEL', trans:'MANUAL', city:'Polonnaruwa', district:'Polonnaruwa', status:'LIVE', specs:{}, desc:'Compact tractor, ideal for paddy fields.' },
  { type:'TRACTOR', make:'Mahindra', model:'Bolero', year:2017, regYear:2017, price:2900000, mileage:4100, fuel:'DIESEL', trans:'MANUAL', city:'Ratnapura', district:'Ratnapura', status:'LIVE', specs:{}, desc:null },

  // ---- HEAVY_MACHINERY ----
  { type:'HEAVY_MACHINERY', make:'JCB', model:'3DX', year:2016, regYear:2017, price:16500000, mileage:6800, fuel:'DIESEL', trans:'MANUAL', city:'Colombo', district:'Colombo', status:'LIVE', specs:{drive_type:'4WD'}, desc:'Backhoe loader, well maintained, ready for site work.' },
  { type:'HEAVY_MACHINERY', make:'Kubota', model:'L3408', year:2015, regYear:null, price:8900000, mileage:9200, fuel:'DIESEL', trans:'MANUAL', city:'Gampaha', district:'Gampaha', status:'LIVE', specs:{}, desc:'Excavator, good working condition.' },

  // ---- NON-LIVE: the status gate must exclude every one of these ----
  { type:'CAR', make:'Toyota', model:'Aqua', year:2018, regYear:2019, price:9100000, mileage:41000, fuel:'HYBRID', trans:'CVT', city:'Colombo', district:'Colombo', status:'PENDING_REVIEW', specs:{body_type:'HATCHBACK',seats:5}, desc:'Awaiting dealer review.' },
  { type:'CAR', make:'Honda', model:'Civic', year:2019, regYear:2020, price:16500000, mileage:31000, fuel:'PETROL', trans:'CVT', city:'Colombo', district:'Colombo', status:'PENDING_REVIEW', specs:{body_type:'SEDAN',seats:5}, desc:'Awaiting dealer review.' },
  { type:'SUV', make:'Honda', model:'Vezel', year:2018, regYear:null, price:13900000, mileage:48000, fuel:'HYBRID', trans:'CVT', city:'Kandy', district:'Kandy', status:'SOLD', specs:{body_type:'SUV',seats:5}, desc:'Already sold.' },
  { type:'CAR', make:'Suzuki', model:'Swift', year:2017, regYear:2018, price:5900000, mileage:57000, fuel:'PETROL', trans:'AUTOMATIC', city:'Galle', district:'Galle', status:'SOLD', specs:{body_type:'HATCHBACK',seats:5}, desc:'Already sold.' },
  { type:'VAN', make:'Toyota', model:'HiAce', year:2015, regYear:null, price:15200000, mileage:158000, fuel:'DIESEL', trans:'MANUAL', city:'Colombo', district:'Colombo', status:'DRAFT', specs:{}, desc:'Draft listing.' },
  { type:'BIKE', make:'Yamaha', model:'FZ', year:2020, regYear:2020, price:640000, mileage:18000, fuel:'PETROL', trans:'MANUAL', city:'Colombo', district:'Colombo', status:'ARCHIVED', specs:{body_type:'MOTORBIKE'}, desc:'Archived listing.' },
  { type:'CAR', make:'Nissan', model:'March', year:2013, regYear:2014, price:4100000, mileage:118000, fuel:'PETROL', trans:'AUTOMATIC', city:'Jaffna', district:'Jaffna', status:'REJECTED', specs:{}, desc:'Rejected listing.' },
];

async function seed() {
  const ds = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: [],
    synchronize: false,
  });

  await ds.initialize();
  console.log('Connected. Seeding users -> dealer_profiles -> vehicles…');

  const dealerIds: string[] = [];

  for (const d of DEALERS) {
    await ds.query(
      `INSERT INTO auth.users (email, password_hash, name, role, is_active)
       VALUES ($1, $2, $3, 'DEALER', true)
       ON CONFLICT (email) DO NOTHING`,
      // Not a real hash — these accounts are never logged into. Seed data only.
      [d.email, 'SEEDED_ACCOUNT_NOT_LOGGABLE', d.name],
    );

    const [u] = await ds.query(`SELECT id FROM auth.users WHERE email = $1`, [d.email]);
    dealerIds.push(u.id);

    await ds.query(
      `INSERT INTO auth.dealer_profiles
         (user_id, company_name, contact_number, dealer_type, city, verification_status)
       VALUES ($1, $2, $3,
               $4::auth.dealer_profiles_dealer_type_enum,
               $5,
               $6::auth.dealer_profiles_verification_status_enum)
       ON CONFLICT (user_id) DO NOTHING`,
      [u.id, d.company, '+94112345678', d.type, d.city, d.status],
    );
  }

  console.log(`  ${dealerIds.length} dealers ready.`);

  let n = 0;
  for (const v of VEHICLES) {
    // Round-robin across dealers so every verification status owns listings.
    const dealerId = dealerIds[n % dealerIds.length];

    // search_text feeds the tsvector trigger (the `q` keyword layer) and,
    // later, the embedding. Built from the same fields ETL's enrich stage
    // would use, so search behaviour here matches production.
    const searchText = [
      v.make, v.model, String(v.year), v.type,
      v.fuel, v.trans, v.city, v.district,
      v.specs.body_type, v.desc,
    ].filter(Boolean).join(' ');

    await ds.query(
      `INSERT INTO marketplace.vehicles
         (dealer_id, vehicle_type, make, model, condition, manufacture_year,
          registration_year, price, is_negotiable, mileage, fuel_type,
          transmission_type, color, owners_count, location_city,
          location_district, description, status, specs, search_text)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20)`,
      [
        dealerId, v.type, v.make, v.model,
        v.year >= 2020 ? 'RECONDITIONED' : 'USED',
        v.year, v.regYear, v.price, n % 3 === 0, v.mileage,
        v.fuel, v.trans,
        ['White', 'Silver', 'Black', 'Blue', 'Red', 'Grey'][n % 6],
        (n % 3) + 1,
        v.city, v.district, v.desc, v.status,
        JSON.stringify(v.specs), searchText,
      ],
    );
    n++;
  }

  console.log(`  ${n} vehicles inserted.`);
  await ds.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
