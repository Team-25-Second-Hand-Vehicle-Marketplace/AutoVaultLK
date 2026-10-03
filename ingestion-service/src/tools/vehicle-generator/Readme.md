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


## Photos (ZIP) with the same run

Add `--zip` to write a ZIP of synthetic photos beside the inventory file, named
after that file's registration numbers (`WP-0001.jpg`, `WP-0001_2.jpg`, ...), so the
two always match. Works for CSV and JSON. `--images-per-vehicle N` sets how many
photos each vehicle gets (default 2).

| Requirement                         | Command                                                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 30 clean JSON + matching ZIP        | `npm run generate:vehicles -- --count 30 --format json --mode clean --zip --output Upload/vehicles.json`          |
| 30 clean CSV + matching ZIP         | `npm run generate:vehicles -- --count 30 --format csv --mode clean --zip --output Upload/vehicles.csv`            |
| 100 mixed JSON, 1 photo each        | `npm run generate:vehicles -- --count 100 --format json --mode mixed --zip --images-per-vehicle 1`                |

The ZIP takes the output file's name with a `.zip` extension. JSON output is an
array of flat objects with numbers as numbers, `true`/`false` as booleans and blank
fields left out. To make photos for a file you already have:

```text
npm run generate:images -- --from-json path/to/vehicles.json --output Upload/vehicles.zip
npm run generate:images -- --from-csv  path/to/vehicles.csv  --output Upload/vehicles.zip
```
