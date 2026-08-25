# Synthetic Vehicle Data Generator

This tool generates synthetic vehicle inventory data for testing the
Second-Hand Vehicle Marketplace ETL pipeline.

It can generate:

- Clean vehicle data
- Dirty vehicle data
- Invalid vehicle data
- Mixed datasets
- CSV files
- JSON files
- Different dataset sizes

The generated data can be used to test ETL extraction, validation,
normalization, rejection, and loading.

---

## Purpose

Manually creating hundreds or thousands of vehicle records for ETL
testing is time-consuming.

This tool allows developers to generate test data automatically.

Example:

```text
Synthetic Data Generator
        |
        v
  Vehicle Records
        |
   +----+----+
   |         |
  CSV       JSON
   |         |
   +----+----+
        |
        v
   ETL Pipeline
        |
   +----+---------+---------+
   |              |         |
 Clean          Dirty     Invalid
   |              |         |
   |          Normalize    Reject
   |              |         |
   +--------------+---------+
                  |
                  v
             PostgreSQL



| Requirement      | Command                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| 100 clean CSV    | `npm run generate:vehicles -- --count 100 --format csv --mode clean`    |
| 100 clean JSON   | `npm run generate:vehicles -- --count 100 --format json --mode clean`   |
| 100 dirty CSV    | `npm run generate:vehicles -- --count 100 --format csv --mode dirty`    |
| 100 dirty JSON   | `npm run generate:vehicles -- --count 100 --format json --mode dirty`   |
| 100 invalid CSV  | `npm run generate:vehicles -- --count 100 --format csv --mode invalid`  |
| 100 invalid JSON | `npm run generate:vehicles -- --count 100 --format json --mode invalid` |
| 1000 mixed CSV   | `npm run generate:vehicles -- --count 1000 --format csv --mode mixed`   |
| 1000 mixed JSON  | `npm run generate:vehicles -- --count 1000 --format json --mode mixed`  |
| 10000 mixed CSV  | `npm run generate:vehicles -- --count 10000 --format csv --mode mixed`  |
