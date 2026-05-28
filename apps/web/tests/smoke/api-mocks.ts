import type { Page, Route } from "@playwright/test";

type JsonBody =
  | null
  | boolean
  | number
  | string
  | JsonBody[]
  | { [key: string]: JsonBody };

type XeroContactMapping = {
  target_type: "tenant" | "property";
  target_id: string;
  target_name: string;
  xero_contact_id: string;
  xero_contact_name: string;
  xero_email: string | null;
};

const entityId = "entity-1";
const propertyId = "property-1";
const siblingPropertyId = "property-2";
const otherOwnerPropertyId = "property-3";
const tenantId = "tenant-1";
const unitId = "unit-1";
const leaseId = "lease-1";
const operatorId = "operator-1";
const assigneeId = "operator-2";
const propertyImageDocumentId = "document-property-image-1";
const tinyPropertyImagePng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);
const migrationTemplateXlsx = Buffer.from(
  "UEsDBBQAAAAIAKiVvFxGx01IlQAAAM0AAAAQAAAAZG9jUHJvcHMvYXBwLnhtbE3PTQvCMAwG4L9SdreZih6kDkQ9ip68zy51hbYpbYT67+0EP255ecgboi6JIia2mEXxLuRtMzLHDUDWI/o+y8qhiqHke64x3YGMsRoPpB8eA8OibdeAhTEMOMzit7Dp1C5GZ3XPlkJ3sjpRJsPiWDQ6sScfq9wcChDneiU+ixNLOZcrBf+LU8sVU57mym/8ZAW/B7oXUEsDBBQAAAAIAKiVvFzNRPzC7wAAACsCAAARAAAAZG9jUHJvcHMvY29yZS54bWzNksFOwzAMhl8F5d467Vg1RV0uIE4gITEJxC1yvC2iaaPEqN3b05atE4IH4Bj7z+fPkmsMCrtIz7ELFNlRuhl80yaFYSuOzEEBJDySNykfE+3Y3HfRGx6f8QDB4Ic5EJRSVuCJjTVsYAJmYSEKXVtUGMlwF894iws+fMZmhlkEashTywmKvAChp4nhNDQ1XAETjCn69F0guxDn6p/YuQPinBySW1J93+f9as6NOxTw9vT4Mq+buTaxaZHGX8kpPgXaisvk19Xd/e5B6FKWVSbXWbnZyY26Xauiep9cf/hdhX1n3d79Y+OLoK7h113oL1BLAwQUAAAACAColbxcmVycIxAGAACcJwAAEwAAAHhsL3RoZW1lL3RoZW1lMS54bWztWltz2jgUfu+v0Hhn9m0LxjaBtrQTc2l227SZhO1OH4URWI1seWSRhH+/RzYQy5YN7ZJNups8BCzp+85FR+foOHnz7i5i6IaIlPJ4YNkv29a7ty/e4FcyJBFBMBmnr/DACqVMXrVaaQDDOH3JExLD3IKLCEt4FMvWXOBbGi8j1uq0291WhGlsoRhHZGB9XixoQNBUUVpvXyC05R8z+BXLVI1lowETV0EmuYi08vlsxfza3j5lz+k6HTKBbjAbWCB/zm+n5E5aiOFUwsTAamc/VmvH0dJIgILJfZQFukn2o9MVCDINOzqdWM52fPbE7Z+Mytp0NG0a4OPxeDi2y9KLcBwE4FG7nsKd9Gy/pEEJtKNp0GTY9tqukaaqjVNP0/d93+ubaJwKjVtP02t33dOOicat0HgNvvFPh8Ouicar0HTraSYn/a5rpOkWaEJG4+t6EhW15UDTIABYcHbWzNIDll4p+nWUGtkdu91BXPBY7jmJEf7GxQTWadIZljRGcp2QBQ4AN8TRTFB8r0G2iuDCktJckNbPKbVQGgiayIH1R4Ihxdyv/fWXu8mkM3qdfTrOa5R/aasBp+27m8+T/HPo5J+nk9dNQs5wvCwJ8fsjW2GHJ247E3I6HGdCfM/29pGlJTLP7/kK6048Zx9WlrBdz8/knoxyI7vd9lh99k9HbiPXqcCzIteURiRFn8gtuuQROLVJDTITPwidhphqUBwCpAkxlqGG+LTGrBHgE323vgjI342I96tvmj1XoVhJ2oT4EEYa4pxz5nPRbPsHpUbR9lW83KOXWBUBlxjfNKo1LMXWeJXA8a2cPB0TEs2UCwZBhpckJhKpOX5NSBP+K6Xa/pzTQPCULyT6SpGPabMjp3QmzegzGsFGrxt1h2jSPHr+BfmcNQockRsdAmcbs0YhhGm78B6vJI6arcIRK0I+Yhk2GnK1FoG2camEYFoSxtF4TtK0EfxZrDWTPmDI7M2Rdc7WkQ4Rkl43Qj5izouQEb8ehjhKmu2icVgE/Z5ew0nB6ILLZv24fobVM2wsjvdH1BdK5A8mpz/pMjQHo5pZCb2EVmqfqoc0PqgeMgoF8bkePuV6eAo3lsa8UK6CewH/0do3wqv4gsA5fy59z6XvufQ9odK3NyN9Z8HTi1veRm5bxPuuMdrXNC4oY1dyzcjHVK+TKdg5n8Ds/Wg+nvHt+tkkhK+aWS0jFpBLgbNBJLj8i8rwKsQJ6GRbJQnLVNNlN4oSnkIbbulT9UqV1+WvuSi4PFvk6a+hdD4sz/k8X+e0zQszQ7dyS+q2lL61JjhK9LHMcE4eyww7ZzySHbZ3oB01+/ZdduQjpTBTl0O4GkK+A226ndw6OJ6YkbkK01KQb8P56cV4GuI52QS5fZhXbefY0dH758FRsKPvPJYdx4jyoiHuoYaYz8NDh3l7X5hnlcZQNBRtbKwkLEa3YLjX8SwU4GRgLaAHg69RAvJSVWAxW8YDK5CifEyMRehw55dcX+PRkuPbpmW1bq8pdxltIlI5wmmYE2eryt5lscFVHc9VW/Kwvmo9tBVOz/5ZrcifDBFOFgsSSGOUF6ZKovMZU77nK0nEVTi/RTO2EpcYvOPmx3FOU7gSdrYPAjK5uzmpemUxZ6by3y0MCSxbiFkS4k1d7dXnm5yueiJ2+pd3wWDy/XDJRw/lO+df9F1Drn723eP6bpM7SEycecURAXRFAiOVHAYWFzLkUO6SkAYTAc2UyUTwAoJkphyAmPoLvfIMuSkVzq0+OX9FLIOGTl7SJRIUirAMBSEXcuPv75Nqd4zX+iyBbYRUMmTVF8pDicE9M3JD2FQl867aJguF2+JUzbsaviZgS8N6bp0tJ//bXtQ9tBc9RvOjmeAes4dzm3q4wkWs/1jWHvky3zlw2zreA17mEyxDpH7BfYqKgBGrYr66r0/5JZw7tHvxgSCb/NbbpPbd4Ax81KtapWQrET9LB3wfkgZjjFv0NF+PFGKtprGtxtoxDHmAWPMMoWY434dFmhoz1YusOY0Kb0HVQOU/29QNaPYNNByRBV4xmbY2o+ROCjzc/u8NsMLEjuHti78BUEsDBBQAAAAIAKiVvFw4bVvmUAEAADACAAAYAAAAeGwvd29ya3NoZWV0cy9zaGVldDEueG1sTVLtasMwDHwV4weo00G3UZJA1zFW2KC0bPvtJkpi6o/MVpbt7Se7TeiPYJ0s3Z3k5KPz59ABIPs12oaCd4j9WohQdWBkWLgeLN00zhuJBH0rQu9B1qnJaHGXZffCSGV5mafc3pe5G1ArC3vPwmCM9H9PoN1Y8CWfEgfVdhgTosx72cIR8KPfe0JiZqmVARuUs8xDU/DNcr1J9angU8EYbmIWJzk5d45gVxc8i4ZAQ4WRQdLxA1vQOhKRje8rJ58lY+NtPLG/pNlplpMMsHX6S9XYFfyRsxoaOWg8uPEVrvOsZoPPEmWZezcyH+cs8yoGUZvqlI37OaKnvCIhLN9ABjUYdqTtINtZlGdgRrVeJv8IptcSIRdIHmOLqOgj+snyRS/u8l36VtnANDQklS0eVpz5i78LQNentzg5RGdS2NGTgo8FdN84hxOI65l/kvIfUEsDBBQAAAAIAKiVvFxAdE/gRgEAAEACAAAYAAAAeGwvd29ya3NoZWV0cy9zaGVldDIueG1sdVLBTsMwDP2VKB9AOqQBmtpK2xCCA9K0CThnjdtGS+rieBT+nqRbp3HgFD/n+dnPST4gHUILwOLbuy4UsmXuF0qFqgWvww320MWbGslrjpAaFXoCbcYi79Rtlt0pr20ny3zMbajM8cjOdrAhEY7ea/pZgcOhkDM5Jba2aTklVJn3uoEd8Fu/oYjURcVYD12w2AmCupDL2WI18kfCu4UhXMUiOdkjHhJ4MYXM0kDgoOKkoOPxBWtwLgnFMT7PmvLSMhVex5P60+g9etnrAGt0H9ZwW8gHKQzU+uh4i8MznP3MLwM+atZlTjgISj7LvEpB6h15tkv72THFvI2NuFyjgVxxHCBhVZ35q//4S2MIQvhbomK7ycKpf9rtq6bGdkE4qKNUdnM/l4JO854AYz++zR6Z0Y9hG58YKBHifY3IE0jrunya8hdQSwMEFAAAAAgAqJW8XHzzo9xRAgAA9gkAAA0AAAB4bC9zdHlsZXMueG1s3VbbitswEP0V4Q+ok5g1cUnyUENgoS0Luw99VWI5EejiyvKS9Os7Izl2s6tZKH2rTfDMHJ25G2fT+6sSz2chPLtoZfptdva++5zn/fEsNO8/2U4YQFrrNPegulPed07wpkeSVvlqsShzzaXJdhsz6L32PTvawfhttsjy3aa1ZrYss2iAo1wL9srVNqu5kgcnw1mupbpG8woNR6usYx5SEUgGS/8rwsuoYZajHy2NdWjMY4Tw6MGpVGpKYJVFw27Tce+FM3tQAicY30FslF+uHWRwcvy6XD1kMyE8IMjBuka4uzqjabdRovVAcPJ0xqe3XY6g91aD0Eh+soaHHG6MUQC3R6HUM47oR3vn+9Ky2OvHBtvMsNSbCAmNYnQTFfT/p7fo+5/dsk6+Wv9lgGpM0H8O1osnJ1p5CfqlvY8/hQ6J3EWfrAyXY5t9x51Tswt2GKTy0ozaWTaNMO9qA/eeH2Cp7/zD+Ua0fFD+ZQK32Sx/E40cdDWdesKyxlOz/BVnuCynzYRY0jTiIpp6VN3pEEQGAkQdLyS8RfbhSiMUJ2JpBDEqDpUBxYksKs7/VM+arCdiVG7rJLImOWuSE1kppA43FSfNqeBKV1pVRVGWVEfrOplBTfWtLPGX9kblhgwqDkb6u17T06Y35OM9oGb60YZQldKbSFVK9xqRdN+QUVXpaVNxkEFNgdodjJ+OgzuV5hQFTpXKjXqDaaSqKAR3Mb2jZUl0p8Q7PR/qLSmKqkojiKUzKAoKwbeRRqgMMAcKKYrwHXzzPcpv36l8/qe3+w1QSwMEFAAAAAgAqJW8XJeKuxzAAAAAEwIAAAsAAABfcmVscy8ucmVsc52SuW7DMAxAf8XQnjAH0CGIM2XxFgT5AVaiD9gSBYpFnb+v2qVxkAsZeT08EtweaUDtOKS2i6kY/RBSaVrVuAFItiWPac6RQq7ULB41h9JARNtjQ7BaLD5ALhlmt71kFqdzpFeIXNedpT3bL09Bb4CvOkxxQmlISzMO8M3SfzL38ww1ReVKI5VbGnjT5f524EnRoSJYFppFydOiHaV/Hcf2kNPpr2MitHpb6PlxaFQKjtxjJYxxYrT+NYLJD+x+AFBLAwQUAAAACAColbxcr9fgF0oBAAC5AgAADwAAAHhsL3dvcmtib29rLnhtbLWS3UrDQBCFXyXsA5g0aMHSeGNRC6LFSu+3yaQZuj9hdtJqn97JhmBAEG+82syZZfacb7I8ezruvT8mH9a4UKiGuV2kaSgbsDpc+RacdGpPVrOUdEhDS6Cr0ACwNWmeZfPUanTqbjnO2lA6LTxDyeidiL2wQziH735fJicMuEeD/Fmo+G1AJRYdWrxAVahMJaHx5ydPePGOtdmW5I0p1Gxo7IAYyx/ytjf5rvchKqz3b1qMFGqeycAaKXC8Eedr8XgCuTxUHfsHNAy00gyP5LsW3aEfIynSSYzIYTwHiAv6C0Zf11jCypedBccDRwLTG3ShwTaoxGkLhVq7wNRFgqGPJe+sqyEii7cJMFqgNGhdRZf/50hW2vbAYeon/8VPHqmNqCqo0UH1IrOC6LK2ckNJf8Rc+fXN7FbW0xlzL9qre/a6GsmPf83dF1BLAwQUAAAACAColbxcjfcsWrQAAACJAgAAGgAAAHhsL19yZWxzL3dvcmtib29rLnhtbC5yZWxzxZJNCoMwEEavEnKAjtrSRVFX3bgtXiDo+IPRhMyU6u1rdaGBLrqRrsI3Ie97MIkfqBW3ZqCmtSTGXg+UyIbZ3gCoaLBXdDIWh/mmMq5XPEdXg1VFp2qEKAiu4PYMmcZ7psgni78QTVW1Bd5N8exx4C9geBnXUYPIUuTK1ciJhFFvY4LlCE8zWYqsTKTLylDCv4UiTyg6UIh40kibzZq9+vOB9Ty/xa19ievQ38nl4wDez0vfUEsDBBQAAAAIAKiVvFxupyS8HgEAAFcEAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbMWUz07DMAzGX6XKdWoyduCA1l2AK+zAC4TWXaPmn2JvdG+P226TQKNiKhKXRo3t7+f4i7J+O0bArHPWYyEaovigFJYNOI0yRPAcqUNymvg37VTUZat3oFbL5b0qgyfwlFOvITbrJ6j13lL23PE2muALkcCiyB7HxJ5VCB2jNaUmjquDr75R8hNBcuWQg42JuOAEoa4S+sjPgFPd6wFSMhVkW53oRTvOUp1VSEcLKKclrvQY6tqUUIVy77hEYkygK2wAyFk5ii6mycQThvF7N5s/yEwBOXObQkR2LMHtuLMlfXUeWQgSmekjXogsPft80LtdQfVLNo/3I6R28APVsMyf8VePL/o39rH6xz7eQ2j/+qr3q3Ta+DNfDe/J5hNQSwECFAMUAAAACAColbxcRsdNSJUAAADNAAAAEAAAAAAAAAAAAAAAgAEAAAAAZG9jUHJvcHMvYXBwLnhtbFBLAQIUAxQAAAAIAKiVvFzNRPzC7wAAACsCAAARAAAAAAAAAAAAAACAAcMAAABkb2NQcm9wcy9jb3JlLnhtbFBLAQIUAxQAAAAIAKiVvFyZXJwjEAYAAJwnAAATAAAAAAAAAAAAAACAAeEBAAB4bC90aGVtZS90aGVtZTEueG1sUEsBAhQDFAAAAAgAqJW8XDhtW+ZQAQAAMAIAABgAAAAAAAAAAAAAAICBIggAAHhsL3dvcmtzaGVldHMvc2hlZXQxLnhtbFBLAQIUAxQAAAAIAKiVvFxAdE/gRgEAAEACAAAYAAAAAAAAAAAAAACAgagJAAB4bC93b3Jrc2hlZXRzL3NoZWV0Mi54bWxQSwECFAMUAAAACAColbxcfPOj3FECAAD2CQAADQAAAAAAAAAAAAAAgAEkCwAAeGwvc3R5bGVzLnhtbFBLAQIUAxQAAAAIAKiVvFyXirscwAAAABMCAAALAAAAAAAAAAAAAACAAaANAABfcmVscy8ucmVsc1BLAQIUAxQAAAAIAKiVvFyv1+AXSgEAALkCAAAPAAAAAAAAAAAAAACAAYkOAAB4bC93b3JrYm9vay54bWxQSwECFAMUAAAACAColbxcjfcsWrQAAACJAgAAGgAAAAAAAAAAAAAAgAEAEAAAeGwvX3JlbHMvd29ya2Jvb2sueG1sLnJlbHNQSwECFAMUAAAACAColbxcbqckvB4BAABXBAAAEwAAAAAAAAAAAAAAgAHsEAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLBQYAAAAACgAKAIQCAAA7EgAAAAA=",
  "base64",
);

const entities = [
  {
    id: entityId,
    organisation_id: "org-1",
    name: "Acme Holdings Pty Ltd",
    abn: "12123123123",
    gst_registered: true,
    xero_tenant_id: null,
    xero_connected_at: null,
    xero_last_sync_at: null,
    notes: null,
    created_at: "2026-05-01T00:00:00.000Z",
    deleted_at: null,
  },
];

const properties = [
  {
    id: propertyId,
    entity_id: entityId,
    name: "Queen Street Retail Centre",
    street_address: "12 Queen Street",
    suburb: "Brisbane City",
    state: "QLD",
    postcode: "4000",
    country_code: "AU",
    property_type: "commercial_retail",
    parcel_id: "L1-SP12345",
    land_sqm: 820,
    building_sqm: 640,
    parking_spaces: 12,
    has_solar_pv: true,
    ownership_structure: "trust",
    owner_legal_name: "Queen Street Property Trust",
    owner_abn: "22123456789",
    trustee_name: "Queen Street Trustee Pty Ltd",
    trust_name: "Queen Street Property Trust",
    invoice_issuer_name: "Queen Street Trustee Pty Ltd",
    billing_contact_name: "Mia Accounts",
    billing_email: "owners@queenstreet.example",
    invoice_reference: "QSR-",
    ownership_split: "100% Queen Street Property Trust",
    owner_gst_registered: true,
    xero_contact_id: "xero-owner-1",
    xero_tracking_category: "Queen Street",
    metadata: {
      property_media: {
        primary_image: {
          title: "Queen Street Retail Centre frontage",
          document_id: propertyImageDocumentId,
          image_document_id: propertyImageDocumentId,
          thumbnail_document_id: propertyImageDocumentId,
          page_url: "https://example.com/queen-street-retail-centre",
          source: {
            source_hint: "Agency listing",
            citation: "Listing photo for Queen Street Retail Centre.",
            confidence: 0.82,
            url: "https://example.com/queen-street-retail-centre",
          },
          confidence: 0.82,
          notes: "Existing reviewed image.",
          selected_at: "2026-05-20T00:00:00.000Z",
        },
      },
      source_citations: {
        owner_abn: {
          source_hint: "Purchase contract vendor schedule",
          citation: "Vendor details",
          confidence: 0.91,
        },
        street_address: {
          source_hint: "Purchase contract property schedule",
          citation: "Property address",
          confidence: 0.88,
        },
      },
      apply_change_history: [
        {
          document_intake_id: "intake-1",
          document_id: "document-1",
          document_type: "purchase_contract",
          changes: [
            {
              field: "street_address",
              before: "12 Queen St",
              after: "12 Queen Street",
              source: {
                source_hint: "Purchase contract property schedule",
                citation: "Property address",
                confidence: 0.88,
              },
            },
            {
              field: "owner_abn",
              before: null,
              after: "22123456789",
              source: {
                source_hint: "Purchase contract vendor schedule",
                citation: "Vendor details",
                confidence: 0.91,
              },
            },
          ],
        },
      ],
      register_import_history: [
        {
          action_id: "register-action-property-1",
          filename: "Acme portfolio register.xlsx",
          sheet: "Properties",
          row: 12,
          source_hint: "Property register",
          confidence: 0.87,
          changes: [
            {
              field: "owner_abn",
              before: null,
              after: "22123456789",
              source: {
                source_hint: "Properties row 12",
                citation: "Owner ABN",
                confidence: 0.87,
              },
            },
          ],
        },
      ],
    },
  },
  {
    id: siblingPropertyId,
    entity_id: entityId,
    name: "Queen Street Warehouse",
    street_address: "24 Queen Street",
    suburb: "Brisbane City",
    state: "QLD",
    postcode: "4000",
    country_code: "AU",
    property_type: "commercial_industrial",
    parcel_id: "L2-SP12345",
    land_sqm: 1200,
    building_sqm: 980,
    parking_spaces: 8,
    has_solar_pv: false,
    ownership_structure: "trust",
    owner_legal_name: "Queen Street Property Trust",
    owner_abn: "22123456789",
    trustee_name: "Queen Street Trustee Pty Ltd",
    trust_name: null,
    invoice_issuer_name: "Queen Street Trustee Pty Ltd",
    billing_contact_name: "Mia Accounts",
    billing_email: "owners@queenstreet.example",
    invoice_reference: "QSW-",
    ownership_split: null,
    owner_gst_registered: true,
    xero_contact_id: "xero-owner-1",
    xero_tracking_category: "Queen Street Warehouse",
    metadata: {},
  },
  {
    id: otherOwnerPropertyId,
    entity_id: entityId,
    name: "Eagle Street Office",
    street_address: "80 Eagle Street",
    suburb: "Brisbane City",
    state: "QLD",
    postcode: "4000",
    country_code: "AU",
    property_type: "commercial_office",
    parcel_id: "L3-SP12345",
    land_sqm: 680,
    building_sqm: 540,
    parking_spaces: 6,
    has_solar_pv: false,
    ownership_structure: "trust",
    owner_legal_name: "Eagle Street Property Trust",
    owner_abn: null,
    trustee_name: "Eagle Street Trustee Pty Ltd",
    trust_name: null,
    invoice_issuer_name: null,
    billing_contact_name: null,
    billing_email: null,
    invoice_reference: "ESO-",
    ownership_split: null,
    owner_gst_registered: true,
    xero_contact_id: "xero-owner-2",
    xero_tracking_category: "Eagle Street Office",
    metadata: {},
  },
];

const tenants = [
  {
    id: tenantId,
    entity_id: entityId,
    legal_name: "Bright Cafe Pty Ltd",
    trading_name: "Bright Cafe",
    abn: "34123456789",
    contact_name: "Mia Hart",
    contact_email: "mia@example.com",
    contact_phone: "0400 111 222",
    billing_email: "accounts@bright.example",
    notes: "Prefers email follow-up.",
    metadata: {
      public_enrichment: {
        source_citations: {
          abn: {
            source_hint: "Australian Business Register",
            citation: "Bright Cafe Pty Ltd",
            confidence: 0.94,
          },
        },
        apply_history: [
          {
            field: "abn",
            label: "ABN",
            before: null,
            after: "34123456789",
            source: {
              source_hint: "Australian Business Register",
              citation: "Bright Cafe Pty Ltd",
              confidence: 0.94,
            },
            applied_at: "2026-05-19T10:00:00.000Z",
            applied_by_user_id: operatorId,
          },
        ],
      },
    },
  },
  {
    id: "tenant-2",
    entity_id: entityId,
    legal_name: "Northwind Fitness Pty Ltd",
    trading_name: "Northwind Fitness",
    abn: "56123456789",
    contact_name: "Leo Nguyen",
    contact_email: "leo@example.com",
    contact_phone: "0400 333 444",
    billing_email: null,
    notes: null,
    metadata: {
      register_import_history: [
        {
          action_id: "register-action-tenant-2",
          filename: "Acme portfolio register.xlsx",
          sheet: "Tenancies",
          row: 28,
          source_hint: "Tenant register",
          confidence: 0.81,
          changes: [
            {
              field: "trading_name",
              before: null,
              after: "Northwind Fitness",
              source: {
                source_hint: "Tenancies row 28",
                citation: "Tenant trading name",
                confidence: 0.81,
              },
            },
          ],
        },
      ],
    },
  },
];

const initialTenantOnboardings = [
  {
    id: "onboarding-1",
    entity_id: entityId,
    lease_id: leaseId,
    tenant_id: tenantId,
    token: "tenant-token-1",
    status: "sent",
    due_date: "2026-05-29",
    expires_at: "2026-06-12T00:00:00.000Z",
    last_sent_at: "2026-05-18T09:30:00.000Z",
    resent_at: null,
    cancel_reason: null,
    onboarding_url: "http://127.0.0.1:3000/onboarding/tenant-token-1",
    portal_url: "http://127.0.0.1:3000/tenant-portal/tenant-token-1",
    submitted_data: {},
    submitted_at: null,
    review_data: {},
    delivery_data: {
      last_attempted_at: "2026-05-18T09:30:00.000Z",
      channels: {
        email: {
          channel: "email",
          status: "sent",
          provider: "mock",
          attempted_at: "2026-05-18T09:30:00.000Z",
          recipient: "mia@example.com",
        },
      },
    },
    reviewed_at: null,
    reviewed_by_user_id: null,
    applied_at: null,
    applied_by_user_id: null,
    created_at: "2026-05-18T09:30:00.000Z",
    updated_at: "2026-05-18T09:30:00.000Z",
    deleted_at: null,
  },
];

const initialOperatorTenantPortalAccounts = [
  {
    id: "portal-account-1",
    tenant_id: tenantId,
    tenant_onboarding_id: "onboarding-1",
    auth_provider: "clerk",
    auth_provider_id: "tenant-subject-one",
    email: "mia@example.com",
    status: "active",
    linked_at: "2026-05-19T09:00:00.000Z",
    created_at: "2026-05-19T09:00:00.000Z",
    updated_at: "2026-05-19T09:30:00.000Z",
    last_seen_at: "2026-05-19T09:30:00.000Z",
    revoked_at: null,
    deleted_at: null,
    recovery_action: null,
    recovery_reason: null,
    recovery_at: null,
  },
];

const obligations = [
  {
    id: "obligation-1",
    entity_id: entityId,
    property_id: propertyId,
    tenancy_unit_id: unitId,
    lease_id: leaseId,
    title: "Insurance certificate renewal",
    category: "insurance",
    status: "open",
    due_date: "2026-05-24",
    completed_at: null,
    priority: 1,
    owner_role: "property_manager",
    notes: "Tenant needs to provide updated public liability certificate.",
    metadata: {},
  },
];

const maintenanceWorkOrders = [
  {
    id: "work-order-1",
    entity_id: entityId,
    property_id: propertyId,
    tenancy_unit_id: unitId,
    tenant_id: tenantId,
    lease_id: leaseId,
    title: "Air conditioning fault",
    description: "Tenant reported warm air from the shopfront unit.",
    status: "awaiting_approval",
    priority: "urgent",
    requested_at: "2026-05-19T01:00:00.000Z",
    contractor_name: "Cool Air Services",
    contractor_email: "service@coolair.example",
    contractor_phone: "07 3000 1111",
    contractor_assigned_at: "2026-05-19T02:00:00.000Z",
    approval_required: true,
    approval_status: "pending",
    approval_limit_cents: 50000,
    quote_amount_cents: 64000,
    approved_by_user_id: null,
    approved_at: null,
    approval_notes: null,
    source_document_id: null,
    invoice_draft_id: null,
    invoice_reference: null,
    invoice_amount_cents: null,
    source_reference: "Tenant email",
    due_date: "2026-05-20",
    completed_at: null,
    notes: "Needs owner approval before work proceeds.",
    document_ids: ["portal-document-1"],
    photo_document_ids: ["portal-photo-1"],
    metadata: {
      comments: [],
      contractor_delivery: {
        email: {
          send: {
            status: "failed",
            provider: "sendgrid",
            attempted_at: "2026-05-19T02:15:00.000Z",
            sent_at: null,
            sent_by_user_id: operatorId,
            provider_message_id: "sg-maintenance-failed",
            recipient_email: "service@coolair.example",
            subject: "Attendance window request",
            body: "Please confirm your first available attendance window.",
            error: "SendGrid returned 500.",
            template_key: "maintenance_contractor_update",
            template_version: "v1",
            retry_count: 1,
          },
          receipts: [
            {
              received_at: "2026-05-19T02:15:00.000Z",
              channel: "email",
              status: "failed",
              provider: "sendgrid",
              recipient_email: "service@coolair.example",
              provider_message_id: "sg-maintenance-failed",
              error: "SendGrid returned 500.",
              subject: "Attendance window request",
              template_key: "maintenance_contractor_update",
              template_version: "v1",
              retry_count: 1,
            },
          ],
          history: [
            {
              event: "provider_delivery_attempted",
              at: "2026-05-19T02:15:00.000Z",
              user_id: operatorId,
              provider: "sendgrid",
              status: "failed",
              recipient_email: "service@coolair.example",
              provider_message_id: "sg-maintenance-failed",
              error: "SendGrid returned 500.",
              subject: "Attendance window request",
              template_key: "maintenance_contractor_update",
              template_version: "v1",
              retry_count: 1,
            },
          ],
        },
      },
      activity_history: [
        {
          timestamp: "2026-05-19T01:00:00.000Z",
          actor: "tenant-portal:header:tenant-t",
          source: "tenant_portal",
          event: "tenant_submitted",
          summary: "Tenant submitted maintenance request.",
          status: "requested",
        },
        {
          timestamp: "2026-05-19T02:00:00.000Z",
          actor: "operator-1",
          source: "operator_api",
          event: "updated",
          summary: "Updated contractor and approval status.",
          status: "awaiting_approval",
        },
        {
          timestamp: "2026-05-19T02:30:00.000Z",
          actor: "operator-1",
          source: "operator_api",
          event: "comment_added",
          summary: "We have asked the contractor for an attendance window.",
          status: "awaiting_approval",
          visibility: "tenant",
        },
      ],
    },
    created_at: "2026-05-19T01:00:00.000Z",
    updated_at: "2026-05-19T02:00:00.000Z",
    deleted_at: null,
    channel_receipts: [
      {
        channel: "email",
        label: "Contractor email",
        provider: "sendgrid",
        status: "failed",
        detail: "SendGrid returned 500.",
        recipient_email: "service@coolair.example",
        recipient_phone: null,
        provider_message_id: "sg-maintenance-failed",
        template_key: "maintenance_contractor_update",
        template_version: "v1",
        attempted_at: "2026-05-19T02:15:00.000Z",
        sent_at: null,
        receipt_at: "2026-05-19T02:15:00.000Z",
        last_event: "failed",
        delivery_trigger: null,
        delivery_attempt_count: 1,
        message_sent: false,
        action_available: false,
        provider_history: [
          {
            event: "provider_delivery_attempted",
            channel: "email",
            status: "failed",
            raw_event: null,
            provider: "sendgrid",
            attempted_at: "2026-05-19T02:15:00.000Z",
            received_at: null,
            recipient_email: "service@coolair.example",
            recipient_phone: null,
            provider_message_id: "sg-maintenance-failed",
            error: "SendGrid returned 500.",
            template_key: "maintenance_contractor_update",
            template_version: "v1",
            delivery_trigger: null,
            recovery_of_generated_at: null,
            delivery_attempt_count: 1,
          },
        ],
        rendered_message_preview: {
          channel: "email",
          provider: "sendgrid",
          recipient_email: "service@coolair.example",
          recipient_phone: null,
          subject: "Attendance window request",
          body_text: "Please confirm your first available attendance window.",
          template_key: "maintenance_contractor_update",
          template_version: "v1",
          action_label: null,
          action_url: null,
        },
      },
    ],
  },
];

const initialTenantPortalDocuments = [
  {
    id: "portal-document-1",
    lease_id: leaseId,
    tenant_onboarding_id: "onboarding-1",
    filename: "bright-cafe-insurance.pdf",
    content_type: "application/pdf",
    byte_size: 45000,
    category: "insurance",
    notes: "Current certificate.",
    source: "tenant_onboarding",
    created_at: "2026-05-18T09:35:00.000Z",
  },
  {
    id: "portal-photo-1",
    lease_id: leaseId,
    tenant_onboarding_id: "onboarding-1",
    filename: "shopfront-ac-photo.jpg",
    content_type: "image/jpeg",
    byte_size: 128000,
    category: "other",
    notes: "Photo attached to the maintenance request.",
    source: "tenant_portal",
    created_at: "2026-05-19T01:00:00.000Z",
  },
];

let tenantPortalDocuments = initialTenantPortalDocuments.map((document) => ({
  ...document,
}));

function operatorDocumentRecords() {
  return tenantPortalDocuments.map((document) => ({
    ...document,
    entity_id: entityId,
    property_id: propertyId,
    tenancy_unit_id: unitId,
    tenant_id: tenantId,
    lease_id: leaseId,
    tenant_onboarding_id: "onboarding-1",
    metadata: { source: document.source },
    deleted_at: null,
  }));
}

const initialTenantPortalNotificationPreferences = {
  email_enabled: true,
  sms_enabled: true,
  billing_email_enabled: true,
  compliance_reminders_enabled: true,
  preferred_channel: "both",
  updated_at: null,
};

let tenantPortalNotificationPreferences = {
  ...initialTenantPortalNotificationPreferences,
};

const brandedCommunicationTemplates = [
  {
    id: "branded-template-1",
    entity_id: entityId,
    key: "invoice_delivery",
    version: "v1",
    channel: "email",
    provider: "sendgrid",
    name: "SKJ invoice delivery",
    subject_template: "Invoice {{invoice_number}} from SKJ Capital",
    body_template:
      "Hi {{tenant_name}}, your reviewed invoice is attached. Please contact SKJ Capital if any detail needs attention.",
    action_label: "View invoice",
    action_url_template: "{{invoice_url}}",
    notes: "Stored override is visible only; runtime sends still use approved templates.",
    is_active: true,
    is_system: false,
    created_by_user_id: operatorId,
    created_at: "2026-05-22T00:00:00.000Z",
    updated_at: "2026-05-22T00:00:00.000Z",
    deleted_at: null,
    metadata: { brand: "SKJ Capital" },
  },
  {
    id: "branded-template-2",
    entity_id: entityId,
    key: "maintenance_contractor_update",
    version: "v1",
    channel: "email",
    provider: "sendgrid",
    name: "Contractor update default",
    subject_template: "Maintenance update requested",
    body_template:
      "Please confirm the attendance window, quote status, or completion evidence for this work order.",
    action_label: null,
    action_url_template: null,
    notes: null,
    is_active: true,
    is_system: true,
    created_by_user_id: null,
    created_at: "2026-05-22T00:10:00.000Z",
    updated_at: "2026-05-22T00:10:00.000Z",
    deleted_at: null,
    metadata: {},
  },
];

function tenantPortalDocumentsByCategory(category: string) {
  return tenantPortalDocuments.filter(
    (document) => document.category === category,
  );
}

function tenantPortalPreferredChannel(
  emailEnabled: boolean,
  smsEnabled: boolean,
) {
  if (emailEnabled && smsEnabled) {
    return "both";
  }
  if (emailEnabled) {
    return "email";
  }
  if (smsEnabled) {
    return "sms";
  }
  return "none";
}

const arrearsCases = [
  {
    id: "arrears-1",
    entity_id: entityId,
    property_id: propertyId,
    tenancy_unit_id: unitId,
    tenant_id: tenantId,
    lease_id: leaseId,
    status: "active",
    currency: "AUD",
    as_of: "2026-05-20",
    balance_current_cents: 0,
    balance_1_30_cents: 880000,
    balance_31_60_cents: 0,
    balance_61_90_cents: 0,
    balance_90_plus_cents: 0,
    total_balance_cents: 880000,
    oldest_unpaid_invoice_date: "2026-05-01",
    last_invoice_date: "2026-05-01",
    source_reference: "May invoice run",
    reminder_stage: 1,
    reminder_frequency_days: 7,
    next_reminder_on: "2026-05-20",
    last_reminder_at: null,
    reminder_paused_until: null,
    dispute_status: "raised",
    dispute_notes: "Tenant queried outgoings allocation.",
    promise_to_pay_date: "2026-05-27",
    promise_to_pay_amount_cents: 880000,
    promise_to_pay_notes: "Tenant expects to clear after statement review.",
    escalation_status: "none",
    escalation_queue: null,
    escalated_at: null,
    assigned_user_id: operatorId,
    notes: "Follow up after statement pack is sent.",
    metadata: {},
    created_at: "2026-05-18T00:00:00.000Z",
    updated_at: "2026-05-19T00:00:00.000Z",
    deleted_at: null,
  },
];

const rentRoll = [
  {
    entity_id: entityId,
    entity_name: "Acme Holdings Pty Ltd",
    property_id: propertyId,
    property_name: "Queen Street Retail Centre",
    tenancy_unit_id: unitId,
    unit_label: "Shop 3",
    lease_id: leaseId,
    tenant_id: tenantId,
    tenant_name: "Bright Cafe",
    lease_status: "active",
    commencement_date: "2025-07-01",
    expiry_date: "2028-06-30",
    tenant_billing_email: "accounts@bright.example",
    annual_rent_cents: 9600000,
    rent_frequency: "monthly",
    charge_rules: [
      {
        id: "charge-1",
        charge_type: "base_rent",
        amount_cents: 800000,
        frequency: "monthly",
        gst_treatment: "taxable",
        xero_account_code: "401",
        xero_tax_type: null,
        start_date: "2025-07-01",
        end_date: null,
        next_due_date: "2026-06-01",
        arrears_or_advance: "advance",
      },
    ],
    charge_rules_total_cents: 800000,
    next_due_date: "2026-06-01",
    gst_readiness_blockers: [],
    xero_readiness_blockers: ["Missing Xero tax type"],
    invoice_readiness_blockers: [],
  },
  {
    entity_id: entityId,
    entity_name: "Acme Holdings Pty Ltd",
    property_id: siblingPropertyId,
    property_name: "Queen Street Warehouse",
    tenancy_unit_id: "unit-2",
    unit_label: "Warehouse 1",
    lease_id: "lease-2",
    tenant_id: "tenant-2",
    tenant_name: "Northwind Fitness",
    lease_status: "active",
    commencement_date: "2026-01-01",
    expiry_date: "2029-12-31",
    tenant_billing_email: null,
    annual_rent_cents: 7200000,
    rent_frequency: "monthly",
    charge_rules: [],
    charge_rules_total_cents: 600000,
    next_due_date: "2026-06-01",
    gst_readiness_blockers: [],
    xero_readiness_blockers: [],
    invoice_readiness_blockers: [],
  },
];

const billingDrafts = [
  {
    id: "billing-draft-1",
    entity_id: entityId,
    property_id: propertyId,
    tenancy_unit_id: unitId,
    tenant_id: tenantId,
    lease_id: leaseId,
    document_id: "document-1",
    document_intake_id: "intake-1",
    status: "approved",
    title: "May rent and outgoings",
    currency: "AUD",
    issue_date: "2026-05-01",
    due_date: "2026-05-15",
    total_cents: 880000,
    notes: "Prepared from the reviewed rent schedule.",
    metadata: {},
    lines: [
      {
        id: "billing-draft-line-1",
        billing_draft_id: "billing-draft-1",
        description: "Base rent",
        amount_cents: 800000,
        currency: "AUD",
        source_hint: "Rent schedule",
        confidence: 0.92,
        metadata: {},
        created_at: "2026-05-01T00:00:00.000Z",
        deleted_at: null,
      },
      {
        id: "billing-draft-line-2",
        billing_draft_id: "billing-draft-1",
        description: "GST",
        amount_cents: 80000,
        currency: "AUD",
        source_hint: "GST schedule",
        confidence: 0.88,
        metadata: {},
        created_at: "2026-05-01T00:00:00.000Z",
        deleted_at: null,
      },
    ],
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    deleted_at: null,
  },
];

const invoiceDrafts = [
  {
    id: "invoice-draft-1",
    entity_id: entityId,
    billing_draft_id: "billing-draft-1",
    property_id: propertyId,
    tenancy_unit_id: unitId,
    tenant_id: tenantId,
    lease_id: leaseId,
    document_id: "document-1",
    document_intake_id: "intake-1",
    status: "approved",
    invoice_number: "INV-1001",
    title: "May rent and outgoings",
    currency: "AUD",
    issue_date: "2026-05-01",
    due_date: "2026-05-15",
    subtotal_cents: 800000,
    gst_cents: 80000,
    total_cents: 880000,
    issuer_name: "Queen Street Trustee Pty Ltd",
    issuer_abn: "22123456789",
    recipient_name: "Bright Cafe Pty Ltd",
    recipient_email: "accounts@bright.example",
    notes: "Approved internal invoice draft.",
    metadata: {
      readiness_blockers: [],
      delivery_state: {
        pdf_preview_generated: true,
        pdf_artifact_stored: true,
        tenant_email_prepared: true,
        delivery_ready: true,
        tenant_email_sent: false,
      },
      delivery_preview: {
        email: {
          to: "accounts@bright.example",
          subject: "Invoice INV-1001",
          body: "Please find your invoice attached.",
          template_key: "invoice_delivery",
          template_version: "v1",
          rendered_message_preview: {
            channel: "email",
            provider: "sendgrid",
            recipient: "accounts@bright.example",
            subject: "Invoice INV-1001",
            body_text: "Please find your invoice attached.",
            template_key: "invoice_delivery",
            template_version: "v1",
            action_label: "View invoice preview",
            action_url: "/api/v1/invoice-drafts/invoice-draft-1/preview",
          },
        },
      },
      pdf_artifact: {
        document_id: "document-1",
      },
      delivery_email: {
        draft: {
          status: "drafted",
          template_key: "invoice_delivery",
          template_version: "v1",
        },
        send: {
          status: "draft",
        },
      },
      payment_status: {
        status: "unpaid",
      },
    },
    lines: [
      {
        id: "invoice-draft-line-1",
        invoice_draft_id: "invoice-draft-1",
        billing_draft_line_id: "billing-draft-line-1",
        description: "Base rent",
        amount_cents: 800000,
        gst_cents: 80000,
        currency: "AUD",
        source_hint: "Rent schedule",
        metadata: {},
        created_at: "2026-05-01T00:00:00.000Z",
        deleted_at: null,
      },
    ],
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    deleted_at: null,
  },
  {
    id: "invoice-draft-failed",
    entity_id: entityId,
    billing_draft_id: "billing-draft-1",
    property_id: propertyId,
    tenancy_unit_id: unitId,
    tenant_id: tenantId,
    lease_id: leaseId,
    document_id: "document-1",
    document_intake_id: "intake-1",
    status: "approved",
    invoice_number: "INV-1002",
    title: "Maintenance recovery invoice",
    currency: "AUD",
    issue_date: "2026-05-02",
    due_date: "2026-05-16",
    subtotal_cents: 800000,
    gst_cents: 80000,
    total_cents: 880000,
    issuer_name: "Queen Street Trustee Pty Ltd",
    issuer_abn: "22123456789",
    recipient_name: "Bright Cafe Pty Ltd",
    recipient_email: "accounts@bright.example",
    notes: "Approved maintenance-linked invoice with provider failure.",
    metadata: {
      readiness_blockers: [],
      delivery_state: {
        pdf_preview_generated: true,
        pdf_artifact_stored: true,
        tenant_email_prepared: true,
        delivery_ready: true,
        tenant_email_sent: false,
      },
      delivery_preview: {
        email: {
          to: "accounts@bright.example",
          subject: "Invoice INV-1002",
          body: "Please find your invoice attached.",
          template_key: "invoice_delivery",
          template_version: "v1",
          rendered_message_preview: {
            channel: "email",
            provider: "sendgrid",
            recipient: "accounts@bright.example",
            subject: "Invoice INV-1002",
            body_text: "Please find your invoice attached.",
            template_key: "invoice_delivery",
            template_version: "v1",
            action_label: "View invoice preview",
            action_url: "/api/v1/invoice-drafts/invoice-draft-failed/preview",
          },
        },
      },
      pdf_artifact: {
        document_id: "document-1",
      },
      delivery_email: {
        draft: {
          status: "drafted",
          template_key: "invoice_delivery",
          template_version: "v1",
        },
        send: {
          status: "draft",
        },
      },
      payment_status: {
        status: "unpaid",
      },
      xero_posting_approval: {
        state: "approved",
        approved: true,
        approved_at: "2026-05-19T10:25:00.000Z",
        idempotency_key: "xero-draft-invoice-draft-failed",
      },
      posting_preparation: {
        external_posting_status: "provider_failed",
        xero_sync_allowed: true,
        xero_sync_requested: true,
        xero_synced: false,
        last_provider_status: "failed",
        last_provider_reason: "Xero provider returned validation error.",
        provider_retry_count: 1,
      },
      provider_dispatch: {
        xero: {
          provider: "xero",
          status: "failed",
          reason: "Xero provider returned validation error.",
          received_at: "2026-05-20T02:00:00.000Z",
          retry_count: 1,
        },
      },
      provider_status_receipts: [
        {
          provider: "xero",
          status: "failed",
          reason: "Xero provider returned validation error.",
          received_at: "2026-05-20T02:00:00.000Z",
          retry_count: 1,
        },
      ],
      xero_sync: {
        xero_synced: false,
      },
    },
    lines: [
      {
        id: "invoice-draft-line-failed",
        invoice_draft_id: "invoice-draft-failed",
        billing_draft_line_id: "billing-draft-line-1",
        description: "Maintenance recovery",
        amount_cents: 800000,
        gst_cents: 80000,
        currency: "AUD",
        source_hint: "Maintenance invoice",
        metadata: {},
        created_at: "2026-05-01T00:00:00.000Z",
        deleted_at: null,
      },
    ],
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    deleted_at: null,
  },
];

const documentIntakes = [
  {
    id: "intake-1",
    entity_id: entityId,
    document_id: "document-1",
    status: "ready_for_review",
    document_type: "lease",
    summary: "Lease summary is ready for review.",
    confidence: 0.86,
    extracted_data: {
      document_type: "lease",
      summary: "Lease summary is ready for review.",
      confidence: 0.86,
      parties: [{ name: "Bright Cafe Pty Ltd", role: "tenant" }],
      properties: [
        { name: "Queen Street Retail Centre", unit_label: "Shop 3" },
      ],
      key_dates: [{ label: "Rent review", date: "2026-07-01" }],
      money_amounts: [{ label: "Annual rent", amount: 96000, currency: "AUD" }],
      obligations: [],
      suggested_links: { tenant_name: "Bright Cafe Pty Ltd" },
      warnings: [],
      missing_information: [],
    },
    review_data: {},
    openai_response_id: "resp-smoke",
    error_message: null,
    reviewed_at: null,
    reviewed_by_user_id: null,
    applied_at: null,
    applied_by_user_id: null,
    created_at: "2026-05-18T08:30:00.000Z",
    updated_at: "2026-05-18T08:30:00.000Z",
    filename: "bright-cafe-lease.pdf",
    content_type: "application/pdf",
    byte_size: 45000,
    category: "lease",
  },
];

const tenancyUnits = [
  {
    id: unitId,
    property_id: propertyId,
    unit_label: "Shop 3",
    sqm: 110,
    parking_spaces: 2,
    metadata: {},
    created_at: "2026-05-01T00:00:00.000Z",
    deleted_at: null,
  },
];

const leases = [
  {
    id: leaseId,
    tenancy_unit_id: unitId,
    tenant_id: tenantId,
    status: "active",
    commencement_date: "2025-07-01",
    expiry_date: "2028-06-30",
    annual_rent_cents: 9600000,
    rent_frequency: "monthly",
    outgoings_recoverable: true,
    next_review_date: "2026-07-01",
    option_summary: "One further term of three years.",
    security_summary: "Bank guarantee held.",
    notes: null,
  },
];

const tenantPortalSession = (
  authMode: "token" | "account" = "token",
  options: {
    tenantId?: string;
    tradingName?: string;
    leaseReady?: boolean;
    leaseSigned?: boolean;
  } = {},
) => ({
  auth:
    authMode === "account"
      ? {
          mode: "tenant_portal_account",
          token_source: "bearer",
          tenant_auth_configured: true,
          dev_fallback: false,
          boundary: "tenant_portal_account",
          detail:
            "Access is scoped to the tenant linked to this tenant portal account.",
        }
      : {
          mode: "tenant_portal_token",
          token_source: "header",
          tenant_auth_configured: false,
          dev_fallback: false,
          boundary: "tenant_onboarding_token",
          detail:
            "Tenant identity-provider auth is not wired yet. Access is scoped to the tenant linked to this onboarding token.",
        },
  tenant: {
    id: options.tenantId ?? tenantId,
    legal_name: "Bright Cafe Pty Ltd",
    trading_name: options.tradingName ?? "Bright Cafe",
    contact_name: "Mia Hart",
    contact_email: "mia@example.com",
    contact_phone: "0400 111 222",
    billing_email: "accounts@bright.example",
  },
  lease: {
    lease_id: leaseId,
    status: "active",
    property_name: "Queen Street Retail Centre",
    property_address: "12 Queen Street, Brisbane City, QLD, 4000",
    unit_label: "Shop 3",
    commencement_date: "2025-07-01",
    expiry_date: "2028-06-30",
    next_review_date: "2026-07-01",
  },
  onboarding: {
    id: "onboarding-1",
    status: options.leaseReady || options.leaseSigned ? "applied" : "sent",
    due_date: "2026-05-29",
    expires_at: "2026-06-12T00:00:00.000Z",
    submitted_at:
      options.leaseReady || options.leaseSigned
        ? "2026-05-21T01:00:00.000Z"
        : null,
    last_sent_at: "2026-05-18T09:30:00.000Z",
    document_count: 1,
    submitted_data:
      options.leaseReady || options.leaseSigned
        ? {
            legal_name: "Bright Cafe Pty Ltd",
            contact_name: "Mia Hart",
            contact_email: "mia@example.com",
            accepted: true,
          }
        : null,
    portal_invite_sent_at: null,
  },
  lease_agreement: {
    status: options.leaseSigned
      ? "signed"
      : options.leaseReady
        ? "ready_to_sign"
        : "not_ready",
    open_question_count: 0,
    questions: [],
    signed_at: options.leaseSigned ? "2026-05-21T02:00:00.000Z" : null,
    signed_by_actor: options.leaseSigned ? "tenant" : null,
    signing_locked_reason:
      options.leaseReady || options.leaseSigned
        ? null
        : "Property team review must be completed before signing.",
  },
  compliance: {
    uploads_enabled: true,
    accepted_categories: [
      "insurance",
      "bank_guarantee",
      "lease",
      "onboarding",
      "other",
    ],
    items: [
      {
        key: "insurance",
        label: "Insurance",
        status: tenantPortalDocumentsByCategory("insurance").length
          ? "received"
          : "not_on_file",
        document_count: tenantPortalDocumentsByCategory("insurance").length,
        latest_document:
          tenantPortalDocumentsByCategory("insurance")[0] ?? null,
        due_date: "2027-06-30",
      },
      {
        key: "bank_guarantee",
        label: "Bank guarantee",
        status: "not_on_file",
        document_count: 0,
        latest_document: null,
        due_date: null,
      },
      {
        key: "onboarding",
        label: "Onboarding files",
        status: tenantPortalDocumentsByCategory("onboarding").length
          ? "received"
          : "not_on_file",
        document_count: tenantPortalDocumentsByCategory("onboarding").length,
        latest_document:
          tenantPortalDocumentsByCategory("onboarding")[0] ?? null,
        due_date: null,
      },
    ],
    uploaded_documents: tenantPortalDocuments,
  },
  invoices: [
    {
      id: "invoice-draft-1",
      invoice_number: "INV-1001",
      title: "May rent and outgoings",
      status: "approved",
      issue_date: "2026-05-01",
      due_date: "2026-05-15",
      currency: "AUD",
      subtotal_cents: 800000,
      gst_cents: 80000,
      total_cents: 880000,
      paid_cents: 0,
      outstanding_cents: 880000,
      payment_status: "unpaid",
      pdf_document_id: "document-1",
      lines: [
        {
          id: "invoice-draft-line-1",
          description: "Base rent",
          amount_cents: 800000,
          gst_cents: 80000,
          currency: "AUD",
        },
      ],
    },
  ],
  payment_summary: {
    invoice_count: 1,
    total_cents: 880000,
    paid_cents: 0,
    outstanding_cents: 880000,
    overdue_count: 1,
    next_due_date: "2026-05-15",
    status: "overdue",
    manual_only: true,
  },
  maintenance_requests: maintenanceWorkOrders
    .filter((workOrder) => workOrder.tenant_id === tenantId)
    .map((workOrder) => ({
      id: workOrder.id,
      title: workOrder.title,
      description: workOrder.description,
      status: workOrder.status,
      priority: workOrder.priority,
      requested_at: workOrder.requested_at,
      source_reference: workOrder.source_reference,
      due_date: workOrder.due_date,
      completed_at: workOrder.completed_at,
      document_ids: workOrder.document_ids,
      photo_document_ids: workOrder.photo_document_ids,
      created_at: workOrder.created_at,
      history: Array.isArray(workOrder.metadata?.activity_history)
        ? workOrder.metadata.activity_history
            .filter((entry) => {
              if (typeof entry !== "object" || !entry) {
                return false;
              }
              const source = "source" in entry ? entry.source : null;
              const visibility =
                "visibility" in entry ? entry.visibility : null;
              return source === "tenant_portal" || visibility === "tenant";
            })
            .map((entry) => ({
              timestamp:
                typeof entry === "object" && entry && "timestamp" in entry
                  ? String(entry.timestamp)
                  : workOrder.created_at,
              event:
                typeof entry === "object" && entry && "event" in entry
                  ? String(entry.event)
                  : "updated",
              summary:
                typeof entry === "object" && entry && "summary" in entry
                  ? String(entry.summary)
                  : "Maintenance request updated.",
              status:
                typeof entry === "object" && entry && "status" in entry
                  ? String(entry.status)
                  : workOrder.status,
            }))
        : [],
    })),
  notification_preferences: tenantPortalNotificationPreferences,
  contact_change_requests: [
    {
      id: "contact-request-1",
      status: "submitted",
      submitted_at: "2026-05-20T10:00:00.000Z",
      applied_at: null,
      dismissed_at: null,
      notes: "Please send billing notices here.",
      changes: [
        {
          field: "billing_email",
          label: "Billing email",
          before: "accounts@bright.example",
          after: "new.accounts@bright.example",
        },
      ],
    },
  ],
  guardrails: [
    "Tenant portal responses are scoped to the tenant attached to the onboarding token.",
    "Only approved invoice drafts are visible to tenants.",
    "Notification preference updates do not send email or SMS.",
  ],
});

const securityWorkspace = () => ({
  auth: {
    auth_mode: "dev",
    dev_auth_active: true,
    clerk_secret_configured: false,
    clerk_jwks_configured: false,
    operator_login_enforced: false,
    login_boundary: "Development operator identity",
    next_steps: [
      "Switch AUTH_MODE to clerk before sending real operator invites.",
      "Set CLERK_SECRET_KEY before enabling provider-backed login.",
    ],
  },
  current_user: {
    id: operatorId,
    organisation_id: "org-1",
    email: "owner@example.com",
    display_name: "Owner Operator",
  },
  organisation: {
    id: "org-1",
    name: "Acme Holdings",
    country_code: "AU",
    timezone: "Australia/Brisbane",
    created_at: "2026-05-01T00:00:00.000Z",
  },
  members: [
    {
      id: operatorId,
      email: "owner@example.com",
      display_name: "Owner Operator",
      is_active: true,
      login_linked: true,
      invite_email_status: "accepted",
      invite_email_detail: "Provider login is linked for this operator.",
      invite_sent_at: "2026-05-01T00:00:00.000Z",
      invite_expires_at: "2026-05-04T00:00:00.000Z",
      invite_accepted_at: "2026-05-01T00:00:00.000Z",
      notification_preferences: {
        work_assignment_email_enabled: true,
        work_assignment_sms_enabled: true,
        work_assignment_sms_phone: "+61400111222",
        work_assignment_notice_template_key: "work_assignment_notification",
        work_assignment_notice_template_version: "v1",
        work_assignment_digest_cadence: "daily",
        work_assignment_digest_template_key: "work_assignment_digest",
        work_assignment_digest_template_version: "v1",
        work_assignment_digest_last_generated_at: "2026-05-21T09:00:00.000Z",
        work_assignment_digest_last_item_count: 4,
        work_assignment_digest_history: [
          {
            event: "digest_generated",
            generated_at: "2026-05-21T09:00:00.000Z",
            entity_id: entityId,
            cadence: "daily",
            item_count: 4,
            ready_count: 2,
            attention_count: 1,
            in_flight_count: 1,
            done_count: 0,
            follow_up_due_count: 2,
            delivery_status: "previewed",
            message_sent: false,
            delivery_detail: null,
            delivery_channel: null,
            provider: null,
            provider_message_id: null,
            template_key: "work_assignment_digest",
            template_version: "v1",
            delivery_trigger: "preview",
            recovery_of_generated_at: null,
            delivery_attempt_count: 0,
          },
        ],
      },
      created_at: "2026-05-01T00:00:00.000Z",
      roles: [
        {
          entity_id: entityId,
          entity_name: "Acme Holdings Pty Ltd",
          role: "owner",
        },
      ],
    },
    {
      id: assigneeId,
      email: "temba@example.com",
      display_name: "Temba van Jaarsveld",
      is_active: true,
      login_linked: true,
      invite_email_status: "accepted",
      invite_email_detail: "Provider login is linked for this operator.",
      invite_sent_at: "2026-05-01T00:00:00.000Z",
      invite_expires_at: "2026-05-04T00:00:00.000Z",
      invite_accepted_at: "2026-05-01T00:00:00.000Z",
      notification_preferences: {
        work_assignment_email_enabled: true,
        work_assignment_sms_enabled: false,
        work_assignment_sms_phone: null,
        work_assignment_notice_template_key: "work_assignment_notification",
        work_assignment_notice_template_version: "v1",
        work_assignment_digest_cadence: "daily",
        work_assignment_digest_template_key: "work_assignment_digest",
        work_assignment_digest_template_version: "v1",
        work_assignment_digest_last_generated_at: null,
        work_assignment_digest_last_item_count: null,
        work_assignment_digest_history: [],
      },
      created_at: "2026-05-01T00:00:00.000Z",
      roles: [
        {
          entity_id: entityId,
          entity_name: "Acme Holdings Pty Ltd",
          role: "ops",
        },
      ],
    },
  ],
  current_user_roles: [
    {
      entity_id: entityId,
      entity_name: "Acme Holdings Pty Ltd",
      role: "owner",
    },
  ],
  can_manage_security: true,
});

const securityBootstrapStatus = () => ({
  available: true,
  reason: "No production workspace exists yet.",
  auth: {
    auth_mode: "clerk",
    dev_auth_active: false,
    clerk_secret_configured: true,
    clerk_jwks_configured: true,
    operator_login_enforced: true,
    login_boundary: "Production operator login",
    next_steps: [],
  },
  organisation_count: 0,
  entity_count: 0,
  operator_count: 0,
});

const corsHeaders = {
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "access-control-allow-origin": "*",
};

async function fulfillJson(route: Route, body: JsonBody, status = 200) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: "application/json",
    headers: corsHeaders,
    status,
  });
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function jsonStringArray(value: JsonBody | undefined) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function jsonRecord(value: JsonBody | undefined) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value;
}

function noticeChannelReceipt(overrides: { [key: string]: JsonBody }) {
  return {
    channel: "email",
    label: "Email",
    provider: null,
    status: null,
    detail: null,
    recipient_email: null,
    recipient_phone: null,
    provider_message_id: null,
    template_key: null,
    template_version: null,
    attempted_at: null,
    sent_at: null,
    receipt_at: null,
    last_event: null,
    delivery_trigger: null,
    delivery_attempt_count: 0,
    message_sent: false,
    action_available: false,
    provider_history: [],
    rendered_message_preview: null,
    ...overrides,
  };
}

function renderedMessagePreview(overrides: { [key: string]: JsonBody }) {
  return {
    channel: "email",
    provider: "sendgrid",
    recipient_email: null,
    recipient_phone: null,
    subject: null,
    body_text: "",
    template_key: null,
    template_version: null,
    action_label: null,
    action_url: null,
    ...overrides,
  };
}

function workNoticeEmailPreview(title: string) {
  return renderedMessagePreview({
    channel: "email",
    provider: "sendgrid",
    recipient_email: "temba@example.com",
    subject: `Leasium work assigned: ${title}`,
    body_text: [
      "Hi Temba van Jaarsveld,",
      "",
      "Maintenance has been assigned to you in Leasium.",
      "",
      `Work: ${title}`,
      "Due: 20 May 2026",
      "Assigned in Leasium",
      "Open work: /operations",
      "",
      "Please open Leasium to review the work, update status, or reassign if needed.",
      "",
      "Leasium",
    ].join("\n"),
    template_key: "work_assignment_notification",
    template_version: "v1",
    action_label: "Open assigned work",
    action_url: "/operations",
  });
}

function workNoticeSmsPreview(title: string) {
  return renderedMessagePreview({
    channel: "sms",
    provider: "twilio",
    recipient_phone: "+61400111222",
    subject: null,
    body_text: `Leasium: Maintenance assigned to Temba van Jaarsveld: ${title}. Due: 20 May 2026. /operations`,
    template_key: "work_assignment_notification",
    template_version: "v1",
    action_label: "Open assigned work",
    action_url: "/operations",
  });
}

function workDigestMessagePreview() {
  return renderedMessagePreview({
    channel: "email",
    provider: "sendgrid",
    recipient_email: "owner@example.com",
    subject: "Leasium Daily Work digest: 4 items",
    body_text: [
      "Hi Owner Operator,",
      "",
      "Your daily Leasium Work digest is ready.",
      "",
      "Open items: 4",
      "Follow-ups due: 2",
      "Attention: 1",
      "Ready notices: 0",
      "",
      "- Air conditioning fault",
      "  Type: Maintenance",
      "  Due: 20 May 2026",
      "  Status: requested",
      "",
      "Please open Leasium to review the work, update status, or reassign if needed.",
      "",
      "Leasium",
    ].join("\n"),
    template_key: "work_assignment_digest",
    template_version: "v1",
  });
}

function assignmentNotificationMetadata(
  value: JsonBody | undefined,
  targetId: string,
) {
  const metadata = { ...jsonRecord(value) };
  const assignment = { ...jsonRecord(metadata.work_assignment) };
  const notification = { ...jsonRecord(assignment.notification) };
  const providerHistory = Array.isArray(notification.provider_history)
    ? notification.provider_history
    : [];
  const assignmentHistory = Array.isArray(assignment.history)
    ? assignment.history
    : [];
  const timestamp = "2026-05-20T01:15:00.000Z";
  const recipient =
    typeof assignment.assigned_user_email === "string" &&
    assignment.assigned_user_email.trim()
      ? assignment.assigned_user_email
      : "temba@example.com";
  const templateKey =
    typeof notification.template_key === "string" && notification.template_key
      ? notification.template_key
      : "work_assignment_notification";
  const templateVersion =
    typeof notification.template_version === "string" &&
    notification.template_version
      ? notification.template_version
      : "v1";
  const receipt = {
    event: "provider_notification_attempted",
    channel: "email",
    status: "queued",
    provider: "sendgrid",
    attempted_at: timestamp,
    sent_at: timestamp,
    sent_by_user_id: operatorId,
    sent_by_name: "Owner Operator",
    recipient_email: recipient,
    provider_message_id: `sg-assignment-${targetId}`,
    error: null,
    template_key: templateKey,
    template_version: templateVersion,
  };
  const historyEntry = {
    event: "provider_notification_attempted",
    at: timestamp,
    actor_user_id: operatorId,
    actor_name: "Owner Operator",
    assigned_user_id:
      typeof assignment.assigned_user_id === "string"
        ? assignment.assigned_user_id
        : null,
    assigned_user_name:
      typeof assignment.assigned_user_name === "string"
        ? assignment.assigned_user_name
        : null,
    assigned_user_email: recipient,
    notification_status: "queued",
    summary: "Assignment notification email was queued.",
  };

  metadata.work_assignment = {
    ...assignment,
    notification: {
      ...notification,
      channel: "email",
      provider: "sendgrid",
      status: "queued",
      recipient_email: recipient,
      provider_message_id: `sg-assignment-${targetId}`,
      attempted_at: timestamp,
      sent_at: timestamp,
      sent_by_user_id: operatorId,
      sent_by_name: "Owner Operator",
      error: null,
      template_key: templateKey,
      template_version: templateVersion,
      detail: "Assignment email was queued by SendGrid.",
      provider_history: [receipt, ...providerHistory].slice(0, 10),
    },
    history: [historyEntry, ...assignmentHistory].slice(0, 10),
  };
  return metadata;
}

function multipartField(body: string, name: string) {
  const match = body.match(
    new RegExp(`name="${name}"\\r?\\n\\r?\\n([^\\r\\n]*)`),
  );
  return match?.[1]?.trim() ?? null;
}

function multipartFilename(body: string) {
  const match = body.match(/name="file"; filename="([^"]+)"/);
  return match?.[1] ?? "tenant-portal-upload";
}

type MockLeasiumApiOptions = {
  tenantAccountLinked?: boolean;
  tenantAccountLinkedToDifferentTenant?: boolean;
  tenantPortalLeaseReady?: boolean;
  xeroDiagnosticsBlocked?: boolean;
};

export async function mockLeasiumApi(
  page: Page,
  options: MockLeasiumApiOptions = {},
) {
  let xeroTenantId: string | null = null;
  let xeroConnectedAt: string | null = null;
  let xeroProviderConnected = false;
  let chargeAccountCode: string | null = "401";
  let chargeTaxType: string | null = null;
  let xeroDraftApproved = false;
  let xeroDraftCreated = false;
  let xeroPaymentApplied = false;
  let localInvoiceDrafts = jsonClone(invoiceDrafts);
  let tenantAccountLinked = options.tenantAccountLinked ?? false;
  let tenantPortalOnboardingSubmitted = false;
  const tenantPortalLeaseReady = options.tenantPortalLeaseReady ?? false;
  let tenantPortalLeaseSigned = false;
  const xeroDiagnosticsBlocked = options.xeroDiagnosticsBlocked ?? false;
  let notificationCenterReadAt: string | null = null;
  let digestReceiptSent = false;
  let assignmentNoticeRetried = false;
  let assignmentNoticeSmsSent = false;
  const tenantAccountLinkedToDifferentTenant =
    options.tenantAccountLinkedToDifferentTenant ?? false;
  let appliedContactMappings: XeroContactMapping[] = [];
  let snapshotCount = 0;
  let insightSnapshots: JsonBody[] = [];
  let tenantPortalDocumentCount = initialTenantPortalDocuments.length;
  let tenantOnboardings = initialTenantOnboardings.map((onboarding) => ({
    ...onboarding,
    delivery_data: {
      ...onboarding.delivery_data,
      channels: { ...onboarding.delivery_data.channels },
    },
  }));
  let operatorTenantPortalAccounts = initialOperatorTenantPortalAccounts.map(
    (account) => ({ ...account }),
  );
  tenantPortalDocuments = initialTenantPortalDocuments.map((document) => ({
    ...document,
  }));
  if (tenantPortalLeaseReady) {
    tenantPortalDocuments.unshift({
      id: "portal-lease-document-1",
      lease_id: leaseId,
      tenant_onboarding_id: "onboarding-1",
      filename: "custom-lease.pdf",
      content_type: "application/pdf",
      byte_size: 76000,
      category: "lease",
      notes: "Custom lease uploaded by the property team.",
      source: "operator_upload",
      created_at: "2026-05-20T03:30:00.000Z",
    });
  }
  tenantPortalNotificationPreferences = {
    ...initialTenantPortalNotificationPreferences,
  };

  const xeroConnection = () => ({
    entity_id: entityId,
    entity_name: "Acme Holdings Pty Ltd",
    connected: Boolean(xeroTenantId),
    xero_tenant_id: xeroTenantId,
    tenant_name: xeroTenantId ? "Demo Xero Org" : null,
    tenant_type: xeroTenantId ? "ORGANISATION" : null,
    connected_at: xeroConnectedAt,
    last_sync_at: null,
    last_contact_sync_at: null,
    provider_configured: true,
    provider_connection_id: xeroProviderConnected ? "xero-connection-1" : null,
    connection_source: xeroProviderConnected
      ? "provider"
      : xeroTenantId
        ? "manual"
        : "none",
    status_label: xeroProviderConnected
      ? "Provider connected"
      : xeroTenantId
        ? "Connected"
        : "Not connected",
    next_action: xeroTenantId
      ? "Preview Xero contacts, then review local mappings before approving any sync."
      : "Connect Xero or record the tenant before any sync approval can be enabled.",
  });

  const xeroStatus = () => {
    const issues = [];
    if (!xeroTenantId) {
      issues.push({
        id: `connection-${entityId}`,
        kind: "connection",
        severity: "blocker",
        label: "Xero is not connected",
        detail: "This entity has no Xero tenant recorded yet.",
        action: "Record the Xero tenant before approving invoice sync.",
        property_id: null,
        property_name: null,
        tenancy_unit_id: null,
        unit_label: null,
        lease_id: null,
        tenant_id: null,
        tenant_name: null,
        charge_rule_id: null,
        charge_type: null,
        current_account_code: null,
        current_tax_type: null,
        suggested_account_code: null,
        suggested_tax_type: null,
      });
    }
    if (!chargeTaxType) {
      issues.push({
        id: "tax-charge-1",
        kind: "tax",
        severity: "blocker",
        label: "Base Rent tax type missing",
        detail:
          "Queen Street Retail Centre / Shop 3 is taxable and needs a Xero tax type.",
        action: "Review and apply the suggested tax mapping.",
        property_id: propertyId,
        property_name: "Queen Street Retail Centre",
        tenancy_unit_id: unitId,
        unit_label: "Shop 3",
        lease_id: leaseId,
        tenant_id: tenantId,
        tenant_name: "Bright Cafe",
        charge_rule_id: "charge-1",
        charge_type: "base_rent",
        current_account_code: chargeAccountCode,
        current_tax_type: chargeTaxType,
        suggested_account_code: "200",
        suggested_tax_type: "OUTPUT",
      });
    }
    if (!xeroDraftCreated) {
      issues.push({
        id: "invoice-sync-invoice-draft-1",
        kind: "invoice_sync",
        severity: "warning",
        label: "Approved invoice not synced",
        detail: "INV-1001 is approved but not posted to Xero.",
        action: xeroDraftApproved
          ? "Run idempotent Xero draft creation when ready."
          : "Approve Xero posting explicitly, then run idempotent draft creation.",
        property_id: propertyId,
        property_name: "Queen Street Retail Centre",
        tenancy_unit_id: unitId,
        unit_label: "Shop 3",
        lease_id: leaseId,
        tenant_id: tenantId,
        tenant_name: "Bright Cafe",
        charge_rule_id: null,
        charge_type: null,
        current_account_code: null,
        current_tax_type: null,
        suggested_account_code: null,
        suggested_tax_type: null,
      });
    }
    const approvedUnsyncedInvoiceCount = xeroDraftCreated ? 0 : 1;
    const xeroLinkedOpenInvoiceCount =
      xeroDraftCreated && !xeroPaymentApplied ? 1 : 0;
    const readinessBlockerCount = issues.filter(
      (issue) => issue.severity === "blocker",
    ).length;
    const readinessWarningCount = issues.filter(
      (issue) => issue.severity === "warning",
    ).length;
    const freshnessStatus = !xeroDraftCreated
      ? "attention"
      : xeroPaymentApplied
        ? "ready"
        : "missing";
    return {
      provider: {
        configured: true,
        missing_config: [],
        redirect_uri: "http://localhost:8000/api/v1/xero/oauth/callback",
        scopes: [
          "offline_access",
          "accounting.contacts.read",
          "accounting.settings.read",
          "accounting.invoices",
        ],
      },
      connection: xeroConnection(),
      contact_mapping: { total: 2, ready: 2, missing: 0 },
      chart_mapping: {
        total: 1,
        ready: chargeAccountCode ? 1 : 0,
        missing: chargeAccountCode ? 0 : 1,
      },
      tax_mapping: {
        total: 1,
        ready: chargeTaxType ? 1 : 0,
        missing: chargeTaxType ? 0 : 1,
      },
      invoice_sync: {
        total_invoice_drafts: 1,
        approved_unsynced: approvedUnsyncedInvoiceCount,
        synced: xeroDraftCreated ? 1 : 0,
        blocked: 0,
      },
      payment_reconciliation: {
        unpaid: xeroPaymentApplied ? 0 : 1,
        partially_paid: 0,
        paid: xeroPaymentApplied ? 1 : 0,
        reconciliation_ready: xeroPaymentApplied ? 1 : 0,
      },
      accounting_freshness: {
        generated_at: "2026-05-20T01:00:00.000Z",
        source: "local_metadata",
        status: freshnessStatus,
        summary: !xeroDraftCreated
          ? "1 Xero readiness issue needs review; 1 approved invoice still need Xero draft creation."
          : xeroPaymentApplied
            ? "Payment reconciliation is fresh for open Xero-linked invoices."
            : "1 open Xero-linked invoice needs a payment reconciliation preview.",
        stale_after_days: 7,
        stale_reconciliation: xeroDraftCreated && !xeroPaymentApplied,
        readiness_issue_count: issues.length,
        readiness_blocker_count: readinessBlockerCount,
        readiness_warning_count: readinessWarningCount,
        approved_unsynced_invoice_count: approvedUnsyncedInvoiceCount,
        xero_linked_open_invoice_count: xeroLinkedOpenInvoiceCount,
        last_contact_sync_at: xeroProviderConnected
          ? "2026-05-20T00:00:00.000Z"
          : null,
        last_chart_tax_validation_at: chargeTaxType
          ? "2026-05-20T00:10:00.000Z"
          : null,
        last_invoice_posting_preview_at: null,
        last_invoice_draft_create_at: xeroDraftCreated
          ? "2026-05-20T00:20:00.000Z"
          : null,
        last_invoice_provider_dispatch_at: null,
        last_payment_reconciliation_preview_at: xeroPaymentApplied
          ? "2026-05-20T00:30:00.000Z"
          : null,
        last_payment_reconciliation_apply_at: xeroPaymentApplied
          ? "2026-05-20T00:35:00.000Z"
          : null,
        last_payment_reconciliation_at: xeroPaymentApplied
          ? "2026-05-20T00:35:00.000Z"
          : null,
        last_payment_reconciliation_source: xeroPaymentApplied
          ? "manual"
          : null,
        last_payment_reconciliation_mode: xeroPaymentApplied
          ? "local_payment_status_apply"
          : null,
        guardrails: [
          "Accounting freshness is calculated from local Leasium metadata only.",
          "Loading Xero status does not refresh tokens, call Xero, post invoices, or reconcile payments.",
          "Stale payment reconciliation is a review cue, not an automatic accounting action.",
        ],
      },
      issues,
      guardrails: [
        "Xero contact apply only saves reviewed local mappings; it does not mutate Xero.",
        "Invoice posting requires explicit local approval before Xero draft creation.",
        "Payment reconciliation is manual status tracking until bank/Xero feeds are connected.",
      ],
    };
  };

  const xeroConnectionDiagnostics = () => {
    const connection = xeroConnection();
    const providerConfigured = true;
    const providerConnected = connection.connection_source === "provider";
    const actionReady = !xeroDiagnosticsBlocked;
    return {
      entity_id: entityId,
      entity_name: "Acme Holdings Pty Ltd",
      provider_configured: providerConfigured,
      missing_config: [],
      redirect_uri: "http://localhost:8000/api/v1/xero/oauth/callback",
      scopes: [
        "offline_access",
        "accounting.contacts.read",
        "accounting.settings.read",
        "accounting.invoices",
      ],
      connected: connection.connected,
      connection_source: connection.connection_source,
      xero_tenant_id: connection.xero_tenant_id,
      tenant_name: connection.tenant_name,
      token_expires_at: providerConnected
        ? "2026-05-19T11:00:00.000Z"
        : null,
      can_start_oauth: providerConfigured && actionReady,
      can_preview_contacts: providerConnected && actionReady,
      can_validate_chart_tax: providerConnected && actionReady,
      can_preview_invoice_posting: providerConnected && actionReady,
      can_create_xero_drafts:
        providerConnected && xeroDraftApproved && actionReady,
      can_preview_payment_reconciliation:
        providerConnected && xeroDraftCreated && actionReady,
      next_steps: xeroDiagnosticsBlocked
        ? ["Your role or authorised scopes do not allow provider actions."]
        : providerConnected
          ? ["Run contact preview next."]
          : ["Connect Xero before provider previews are enabled."],
      guardrails: [
        "Diagnostics are local only; loading this panel does not call Xero.",
        "No Xero write occurs until an explicit reviewed action is run.",
      ],
    };
  };

  const ownerStatements = (month: string) => {
    type OwnerLine = {
      property_id: string;
      property_name: string;
      invoiced_cents: number;
      paid_cents: number;
      outstanding_cents: number;
      invoice_count: number;
    };
    type OwnerStatement = {
      owner_identity: string;
      owner_legal_name: string | null;
      trustee_name: string | null;
      trust_name: string | null;
      invoice_issuer_name: string | null;
      billing_contact_name: string | null;
      billing_email: string | null;
      property_count: number;
      properties: OwnerLine[];
      invoiced_cents: number;
      paid_cents: number;
      outstanding_cents: number;
      invoice_count: number;
    };
    const owners = new Map<string, OwnerStatement>();
    for (const draft of localInvoiceDrafts) {
      if (draft.status !== "approved" || !draft.issue_date.startsWith(month)) {
        continue;
      }
      const property =
        properties.find((item) => item.id === draft.property_id) ??
        properties[0];
      const ownerIdentity =
        property.trust_name ??
        property.owner_legal_name ??
        property.invoice_issuer_name ??
        "Unattributed";
      const owner = owners.get(ownerIdentity) ?? {
        owner_identity: ownerIdentity,
        owner_legal_name: property.owner_legal_name,
        trustee_name: property.trustee_name,
        trust_name: property.trust_name,
        invoice_issuer_name: property.invoice_issuer_name,
        billing_contact_name: property.billing_contact_name,
        billing_email: property.billing_email,
        property_count: 0,
        properties: [],
        invoiced_cents: 0,
        paid_cents: 0,
        outstanding_cents: 0,
        invoice_count: 0,
      };
      const metadata = jsonRecord(draft.metadata as JsonBody | undefined);
      const paymentStatus = jsonRecord(metadata.payment_status);
      const paidCents =
        paymentStatus.status === "paid"
          ? Number(paymentStatus.paid_cents ?? draft.total_cents)
          : 0;
      const outstandingCents = Math.max(draft.total_cents - paidCents, 0);
      let line = owner.properties.find(
        (item) => item.property_id === property.id,
      );
      if (!line) {
        line = {
          property_id: property.id,
          property_name: property.name,
          invoiced_cents: 0,
          paid_cents: 0,
          outstanding_cents: 0,
          invoice_count: 0,
        };
        owner.properties.push(line);
        owner.property_count += 1;
      }
      line.invoiced_cents += draft.total_cents;
      line.paid_cents += paidCents;
      line.outstanding_cents += outstandingCents;
      line.invoice_count += 1;
      owner.invoiced_cents += draft.total_cents;
      owner.paid_cents += paidCents;
      owner.outstanding_cents += outstandingCents;
      owner.invoice_count += 1;
      owners.set(ownerIdentity, owner);
    }
    const [year, monthNumber] = month.split("-").map(Number);
    const monthEndDay = new Date(year, monthNumber, 0).getDate();
    return {
      entity_id: entityId,
      month,
      month_start: `${month}-01`,
      month_end: `${month}-${String(monthEndDay).padStart(2, "0")}`,
      owners: Array.from(owners.values()).sort(
        (left, right) => right.invoiced_cents - left.invoiced_cents,
      ),
      generated_at: "2026-05-25T00:00:00.000Z",
    };
  };

  const xeroExceptionItemBase = () => ({
    property_id: null,
    property_name: null,
    tenancy_unit_id: null,
    unit_label: null,
    lease_id: null,
    tenant_id: null,
    tenant_name: null,
    charge_rule_id: null,
    charge_type: null,
    current_account_code: null,
    current_tax_type: null,
    suggested_account_code: null,
    suggested_tax_type: null,
    invoice_draft_id: null,
    invoice_number: null,
    invoice_title: null,
    total_cents: null,
    currency: null,
    provider: null,
    provider_status: null,
    external_posting_status: null,
    idempotency_key: null,
    xero_invoice_id: null,
    xero_status: null,
    received_at: null,
    retry_count: null,
  });

  const xeroExceptionQueue = () => {
    const items: Array<Record<string, JsonBody>> = [];
    if (!xeroTenantId) {
      items.push({
        ...xeroExceptionItemBase(),
        id: `connection-${entityId}`,
        kind: "connection",
        severity: "blocker",
        label: "Xero is not connected",
        detail: "This entity has no Xero tenant recorded yet.",
        action: "Record the Xero tenant before approving invoice sync.",
        next_action: "connect_xero",
        source: "xero_status",
      });
    }
    if (!chargeTaxType) {
      items.push({
        ...xeroExceptionItemBase(),
        id: "tax-charge-1",
        kind: "tax",
        severity: "blocker",
        label: "Base Rent tax type missing",
        detail:
          "Queen Street Retail Centre / Shop 3 is taxable and needs a Xero tax type.",
        action: "Review and apply the suggested tax mapping.",
        next_action: "review_chart_tax_mapping",
        source: "xero_status",
        property_id: propertyId,
        property_name: "Queen Street Retail Centre",
        tenancy_unit_id: unitId,
        unit_label: "Shop 3",
        lease_id: leaseId,
        tenant_id: tenantId,
        tenant_name: "Bright Cafe",
        charge_rule_id: "charge-1",
        charge_type: "base_rent",
        current_account_code: chargeAccountCode,
        current_tax_type: chargeTaxType,
        suggested_account_code: "200",
        suggested_tax_type: "OUTPUT",
      });
    }
    if (!xeroDraftCreated) {
      items.push({
        ...xeroExceptionItemBase(),
        id: "invoice-sync-invoice-draft-1",
        kind: "invoice_sync",
        severity: "warning",
        label: xeroDraftApproved
          ? "Approved invoice not synced"
          : "Needs Xero approval",
        detail: "INV-1001 is approved but not posted to Xero.",
        action: xeroDraftApproved
          ? "Run idempotent Xero draft creation when ready."
          : "Approve Xero posting explicitly, then run idempotent draft creation.",
        next_action: xeroDraftApproved
          ? "review_invoice_posting"
          : "review_invoice_posting",
        source: "xero_status",
        property_id: propertyId,
        tenancy_unit_id: unitId,
        lease_id: leaseId,
        tenant_id: tenantId,
        invoice_draft_id: "invoice-draft-1",
        invoice_number: "INV-1001",
        invoice_title: "June 2026 Rent",
        total_cents: 880000,
        currency: "AUD",
      });
    }
    if (xeroDraftCreated && !xeroPaymentApplied) {
      items.push({
        ...xeroExceptionItemBase(),
        id: "xero-payment-invoice-draft-1",
        kind: "payment",
        severity: "info",
        label: "Xero payment status needs review",
        detail:
          "INV-1001 is linked to a Xero draft but Leasium still shows unpaid.",
        action:
          "Preview provider payments, then apply reviewed local payment metadata if a match is found.",
        next_action: "preview_payment_reconciliation",
        source: "invoice_payment_metadata",
        property_id: propertyId,
        tenancy_unit_id: unitId,
        lease_id: leaseId,
        tenant_id: tenantId,
        invoice_draft_id: "invoice-draft-1",
        invoice_number: "INV-1001",
        invoice_title: "June 2026 Rent",
        total_cents: 880000,
        currency: "AUD",
        provider: "xero",
        provider_status: "unpaid",
        xero_invoice_id: "xero-invoice-smoke-1",
      });
    }
    return {
      entity_id: entityId,
      generated_at: "2026-05-19T10:45:00.000Z",
      summary: {
        total: items.length,
        blockers: items.filter((item) => item.severity === "blocker").length,
        warnings: items.filter((item) => item.severity === "warning").length,
        info: items.filter((item) => item.severity === "info").length,
        connection: items.filter((item) => item.kind === "connection").length,
        contact: items.filter((item) => item.kind === "contact").length,
        chart: items.filter((item) => item.kind === "chart").length,
        tax: items.filter((item) => item.kind === "tax").length,
        invoice_sync: items.filter((item) => item.kind === "invoice_sync")
          .length,
        provider: items.filter((item) => item.kind === "provider").length,
        payment: items.filter((item) => item.kind === "payment").length,
      },
      items,
      guardrails: [
        "The exception queue is built from local Leasium records only.",
        "Loading this queue does not refresh Xero tokens, call Xero APIs, post invoices, send emails, or reconcile payments.",
        "Provider actions still require explicit operator review before any mutation is attempted.",
      ],
    };
  };

  const activeInvoiceDraft = () => localInvoiceDrafts[0];

  const activeInvoiceMetadata = () =>
    activeInvoiceDraft().metadata as unknown as Record<string, JsonBody>;

  const xeroProviderReceipt = (receivedAt: string) => ({
    provider: "xero",
    status: "created",
    reason: "Xero draft invoice was created after explicit approval.",
    external_posting_status: "draft_created",
    idempotency_key: "xero-draft-invoice-draft-1",
    xero_invoice_id: "xero-invoice-smoke-1",
    xero_status: "DRAFT",
    received_at: receivedAt,
    retry_count: 1,
  });

  const markXeroApproval = (approved: boolean) => {
    const metadata = activeInvoiceMetadata();
    metadata.xero_posting_approval = {
      state: approved ? "approved" : "revoked",
      approved,
      approved_at: approved ? "2026-05-19T10:25:00.000Z" : null,
      idempotency_key: approved ? "xero-draft-invoice-draft-1" : null,
    };
    metadata.posting_preparation = {
      external_posting_status: approved
        ? "approved_pending_xero_draft"
        : "approval_revoked",
      xero_sync_allowed: approved,
      xero_sync_requested: approved,
      xero_synced: false,
    };
  };

  const markXeroDraftCreated = (createdAt: string) => {
    const metadata = activeInvoiceMetadata();
    const receipt = xeroProviderReceipt(createdAt);
    metadata.xero_sync = {
      xero_synced: true,
      xero_invoice_id: "xero-invoice-smoke-1",
      xero_status: "DRAFT",
      idempotency_key: "xero-draft-invoice-draft-1",
      synced_at: createdAt,
    };
    metadata.posting_preparation = {
      external_posting_status: "draft_created",
      xero_sync_allowed: true,
      xero_sync_requested: true,
      xero_synced: true,
      last_provider_status: "created",
      last_provider_reason:
        "Xero draft invoice was created after explicit approval.",
      provider_retry_count: 1,
    };
    metadata.provider_dispatch = { xero: receipt };
    metadata.provider_status_receipts = [receipt];
  };

  const markInvoiceProviderEmailSent = (sentAt: string) => {
    const metadata = activeInvoiceMetadata();
    const deliveryState =
      metadata.delivery_state && typeof metadata.delivery_state === "object"
        ? { ...(metadata.delivery_state as Record<string, JsonBody>) }
        : {};
    deliveryState.tenant_email_sent = true;
    deliveryState.tenant_email_sent_at = sentAt;
    deliveryState.tenant_email_delivery_method = "sendgrid";
    deliveryState.tenant_email_provider_status = "queued";
    deliveryState.xero_synced = true;
    metadata.delivery_state = deliveryState;
    metadata.delivery_email = {
      send: {
        status: "queued",
        provider: "sendgrid",
        provider_message_id: "sg-dispatch-smoke-1",
        sent_at: sentAt,
        xero_synced: true,
      },
    };
  };

  const markInvoicePaymentReconciled = (reconciledAt: string) => {
    xeroPaymentApplied = true;
    const metadata = activeInvoiceMetadata();
    const paymentStatus = {
      status: "paid",
      paid_cents: 880000,
      outstanding_cents: 0,
      paid_at: null,
      updated_at: reconciledAt,
      source: "xero_payment_reconciliation_provider",
    };
    metadata.payment_status = paymentStatus;
    metadata.payment_history = [paymentStatus];
    metadata.xero_payment_reconciliation = {
      idempotency_key: "xero-payment-smoke-1",
      invoice_draft_id: "invoice-draft-1",
      invoice_number: "INV-1001",
      xero_invoice_id: "xero-invoice-smoke-1",
      provider_payment_id: "provider-payment-smoke-1",
      source: "provider",
      status: "paid",
      paid_cents: 880000,
      reconciled_at: reconciledAt,
      match_method: "Matched by Xero invoice ID.",
      match_confidence: "high",
      amount_delta_cents: 0,
      bank_transaction_id: "bank-txn-smoke-1",
      bank_account_name: "Operating Account",
      statement_date: "2026-05-19",
      statement_amount_cents: 880000,
      counterparty: "Bright Cafe",
      reference: "INV-1001",
      guardrail_flags: [
        "no_bank_feed_mutation",
        "local_payment_metadata_only",
        "bank_evidence_stored",
      ],
    };
    metadata.xero_payment_reconciliation_history = [
      metadata.xero_payment_reconciliation,
    ];
  };

  const xeroPaymentReconciliationResult = (applied: boolean) => ({
    entity_id: entityId,
    source: "provider",
    provider_configured: true,
    provider_connection_id: "xero-connection-1",
    checked_payments: 1,
    ready_count: applied ? 0 : 1,
    applied_count: applied ? 1 : 0,
    skipped_count: 0,
    blocked_count: 0,
    reconciled_at: applied
      ? "2026-05-19T10:42:00.000Z"
      : "2026-05-19T10:40:00.000Z",
    results: [
      {
        invoice_draft_id: "invoice-draft-1",
        invoice_number: "INV-1001",
        status: applied ? "applied" : "ready",
        reason: applied
          ? "Payment status was reconciled locally."
          : "Payment status can be reconciled locally.",
        current_status: applied ? "unpaid" : "unpaid",
        proposed_status: "paid",
        current_paid_cents: 0,
        proposed_paid_cents: 880000,
        outstanding_cents: 0,
        idempotency_key: "xero-payment-smoke-1",
        match_method: "Matched by Xero invoice ID.",
        match_confidence: "high",
        amount_delta_cents: 0,
        bank_transaction_id: "bank-txn-smoke-1",
        bank_account_name: "Operating Account",
        statement_date: "2026-05-19",
        statement_amount_cents: 880000,
        counterparty: "Bright Cafe",
        reference: "INV-1001",
        guardrail_flags: [
          "no_bank_feed_mutation",
          "local_payment_metadata_only",
          "bank_evidence_stored",
        ],
      },
    ],
    guardrails: [
      "Payment reconciliation preview does not change local invoice payment status.",
      "Apply only updates Leasium invoice payment metadata; it never mutates Xero payments.",
      "Duplicate payment idempotency keys are skipped.",
      "Bank-feed evidence is stored for review only; Leasium does not create, edit, or match bank transactions in Xero.",
    ],
  });

  const xeroChartTaxValidationPreview = () => {
    const chartReady =
      chargeAccountCode === "401" || chargeAccountCode === "200";
    const taxReady = chargeTaxType === "OUTPUT";
    const resultStatus =
      chartReady && taxReady
        ? "ready"
        : chargeTaxType
          ? "not_found"
          : "needs_mapping";
    const blockers = [
      ...(chartReady
        ? []
        : chargeAccountCode
          ? [`Account code ${chargeAccountCode} was not found in Xero.`]
          : ["Xero account code is missing."]),
      ...(taxReady
        ? []
        : chargeTaxType
          ? [`Tax type ${chargeTaxType} was not found in Xero.`]
          : ["Taxable charge is missing a Xero tax type."]),
    ];

    return {
      entity_id: entityId,
      xero_tenant_id: xeroTenantId ?? "tenant-smoke",
      tenant_name: "Demo Xero Org",
      fetched_accounts: 2,
      fetched_tax_rates: 2,
      checked_rules: 1,
      results: [
        {
          charge_rule_id: "charge-1",
          charge_type: "base_rent",
          property_name: "Queen Street Retail Centre",
          unit_label: "Shop 3",
          tenant_name: "Bright Cafe",
          account_code: chargeAccountCode,
          account_name: chartReady ? "Rental Income" : null,
          account_status: chartReady ? "ACTIVE" : null,
          account_valid: chartReady,
          tax_type: chargeTaxType,
          tax_name: taxReady ? "GST on Income" : null,
          tax_valid: taxReady,
          suggested_account_code: "200",
          suggested_tax_type: "OUTPUT",
          status: resultStatus,
          blockers,
        },
      ],
      validated_at: "2026-05-19T10:12:00.000Z",
      guardrails: [
        "This preview validates local charge-rule mappings against provider chart and tax settings only.",
        "No invoice posting or tenant email is triggered by chart/tax validation.",
        "Payment reconciliation remains separate and manual.",
      ],
    };
  };

  const xeroInvoicePostingPreview = () => ({
    entity_id: entityId,
    xero_tenant_id: xeroTenantId ?? "tenant-smoke",
    tenant_name: "Demo Xero Org",
    checked_invoices: 1,
    ready_count: 1,
    blocked_count: 0,
    results: [
      {
        invoice_draft_id: "invoice-draft-1",
        invoice_number: "INV-1001",
        title: "May rent and outgoings",
        status: "ready",
        xero_contact_id: "contact-bright-cafe",
        contact_name: "Bright Cafe",
        issue_date: "2026-05-01",
        due_date: "2026-05-15",
        currency: "AUD",
        total_cents: 880000,
        line_count: 1,
        line_items: [
          {
            description: "Base rent",
            quantity: 1,
            unit_amount: 8000,
            account_code: "401",
            tax_type: "OUTPUT",
            line_amount: 8000,
            source_line_id: "invoice-draft-line-1",
          },
        ],
        blockers: [],
        payload_preview: {
          Type: "ACCREC",
          Contact: { ContactID: "contact-bright-cafe" },
          LineItems: [{ Description: "Base rent", AccountCode: "401" }],
        },
      },
    ],
    prepared_at: "2026-05-19T10:20:00.000Z",
    guardrails: [
      "No Xero posting, email, or payment mutation is performed by this preview.",
      "The preview builds local payloads only and does not create Xero invoices.",
      "Payment reconciliation remains manual until a separate approval path exists.",
    ],
  });

  const registerImportDryRun = () => ({
    plan_id: "register-plan-1",
    entity_id: entityId,
    filename: "portfolio-import.xlsx",
    sheets: [
      {
        name: "Properties",
        rows: 3,
        columns: ["Property", "Address", "Owner", "ABN"],
      },
    ],
    actions: [
      {
        target: "property",
        create: 1,
        match: 0,
        update: 1,
        skip: 0,
        review: 1,
      },
    ],
    action_items: [
      {
        id: "register-action-1",
        target: "property",
        operation: "create",
        label: "Create Queen Street Retail",
        summary: "Create a new property from the workbook row.",
        source: {
          filename: "portfolio-import.xlsx",
          sheet: "Properties",
          row: 2,
          source_hint: "Properties row 2",
          confidence: 0.96,
        },
        changes: [
          {
            field: "name",
            label: "Property name",
            before: null,
            after: "Queen Street Retail",
            source: null,
          },
          {
            field: "street_address",
            label: "Street address",
            before: null,
            after: "100 Queen Street",
            source: null,
          },
          {
            field: "owner_abn",
            label: "Owner ABN",
            before: null,
            after: "11 222 333 444",
            source: null,
          },
        ],
        payload: { name: "Queen Street Retail" },
        blockers: [],
        warnings: [],
        default_decision: "approve",
      },
      {
        id: "register-action-2",
        target: "tenant",
        operation: "update",
        label: "Review Bright Cafe contact",
        summary: "Update tenant contact details after operator review.",
        source: {
          filename: "portfolio-import.xlsx",
          sheet: "Tenants",
          row: 5,
          source_hint: "Tenants row 5",
          confidence: 0.81,
        },
        changes: [
          {
            field: "billing_email",
            label: "Billing email",
            before: "old@example.com",
            after: "accounts@bright.example",
            source: null,
          },
        ],
        payload: { billing_email: "accounts@bright.example" },
        blockers: [],
        warnings: ["Existing tenant matched by name only."],
        default_decision: "review",
      },
      {
        id: "register-action-3",
        target: "lease",
        operation: "create",
        label: "Create lease for missing unit",
        summary: "Lease row cannot apply until the unit label is fixed.",
        source: {
          filename: "portfolio-import.xlsx",
          sheet: "Leases",
          row: 9,
          source_hint: "Leases row 9",
          confidence: 0.4,
        },
        changes: [
          {
            field: "unit_label",
            label: "Unit",
            before: null,
            after: "",
            source: null,
          },
        ],
        payload: {},
        blockers: ["Unit label is missing."],
        warnings: [],
        default_decision: "review",
      },
    ],
    findings: [
      {
        severity: "warning",
        message: "Existing tenant matched by name only.",
        sheet: "Tenants",
        row: 5,
        field: "tenant",
        source_value: "Bright Cafe",
      },
      {
        severity: "blocker",
        message: "Unit label is missing.",
        sheet: "Leases",
        row: 9,
        field: "unit_label",
        source_value: "",
      },
    ],
    feature_candidates: [],
    totals: { properties: 1, tenancies: 1, leases: 1 },
    importable: true,
    summary: "3 staged register actions from portfolio-import.xlsx.",
  });

  const insightsOverview = () => {
    const xero = xeroStatus();
    const accountingReadiness = {
      generated_at: xero.accounting_freshness.generated_at,
      source: xero.accounting_freshness.source,
      status: xero.accounting_freshness.status,
      summary: xero.accounting_freshness.summary,
      readiness_issue_count: xero.accounting_freshness.readiness_issue_count,
      readiness_blocker_count:
        xero.accounting_freshness.readiness_blocker_count,
      readiness_warning_count:
        xero.accounting_freshness.readiness_warning_count,
      stale_after_days: xero.accounting_freshness.stale_after_days,
      contact_ready: xero.contact_mapping.ready,
      contact_missing: xero.contact_mapping.missing,
      chart_ready: xero.chart_mapping.ready,
      chart_missing: xero.chart_mapping.missing,
      tax_ready: xero.tax_mapping.ready,
      tax_missing: xero.tax_mapping.missing,
      approved_unsynced_invoice_count: xero.invoice_sync.approved_unsynced,
      unpaid_invoice_count: xero.payment_reconciliation.unpaid,
      stale_reconciliation: xero.accounting_freshness.stale_reconciliation,
      xero_linked_open_invoice_count:
        xero.accounting_freshness.xero_linked_open_invoice_count,
      last_contact_sync_at: xero.accounting_freshness.last_contact_sync_at,
      last_chart_tax_validation_at:
        xero.accounting_freshness.last_chart_tax_validation_at,
      last_invoice_posting_preview_at:
        xero.accounting_freshness.last_invoice_posting_preview_at,
      last_invoice_draft_create_at:
        xero.accounting_freshness.last_invoice_draft_create_at,
      last_invoice_provider_dispatch_at:
        xero.accounting_freshness.last_invoice_provider_dispatch_at,
      last_payment_reconciliation_preview_at:
        xero.accounting_freshness.last_payment_reconciliation_preview_at,
      last_payment_reconciliation_apply_at:
        xero.accounting_freshness.last_payment_reconciliation_apply_at,
      last_payment_reconciliation_at:
        xero.accounting_freshness.last_payment_reconciliation_at,
      last_payment_reconciliation_source:
        xero.accounting_freshness.last_payment_reconciliation_source,
      last_payment_reconciliation_mode:
        xero.accounting_freshness.last_payment_reconciliation_mode,
      guardrails: xero.accounting_freshness.guardrails,
    };
    return {
      entity: {
        id: entityId,
        name: "Acme Holdings Pty Ltd",
        gst_registered: true,
        xero_connected: Boolean(xeroTenantId),
        xero_last_sync_at: null,
      },
      as_of: "2026-05-19",
      portfolio_health: {
        property_count: 1,
        tenant_count: 2,
        unit_count: 1,
        active_lease_count: 1,
        vacant_unit_count: 0,
        overdue_obligation_count: 0,
        due_soon_obligation_count: 1,
        open_obligation_count: 1,
        smart_intake_waiting_count: 1,
        tenant_onboarding_waiting_count: 1,
      },
      live_exceptions: [
        {
          id: "obligation-obligation-1",
          kind: "obligation",
          severity: "warning",
          title: "Insurance certificate renewal",
          detail: "Insurance obligation due 2026-05-24.",
          chip: "In 5d",
          due_date: "2026-05-24",
          source: "Tasks",
          href: "/tasks",
          target: {
            property_id: propertyId,
            tenancy_unit_id: unitId,
            lease_id: leaseId,
            tenant_id: null,
            document_intake_id: null,
            obligation_id: "obligation-1",
            billing_draft_id: null,
            invoice_draft_id: null,
          },
          rank: 5,
        },
        {
          id: "smart-intake-intake-1",
          kind: "smart_intake",
          severity: "primary",
          title: "bright-cafe-lease.pdf",
          detail: "Lease summary is ready for review.",
          chip: "Ready For Review",
          due_date: null,
          source: "Smart Intake",
          href: "/intake?review=intake-1",
          target: {
            property_id: null,
            tenancy_unit_id: null,
            lease_id: null,
            tenant_id: null,
            document_intake_id: "intake-1",
            obligation_id: null,
            billing_draft_id: null,
            invoice_draft_id: null,
          },
          rank: -1,
        },
        ...xero.issues.map((issue, index) => ({
          id: `xero-${issue.id}`,
          kind: "xero_readiness",
          severity: issue.severity === "blocker" ? "danger" : "warning",
          title: issue.label,
          detail: issue.detail,
          chip: issue.severity === "blocker" ? "Blocker" : "Warning",
          due_date: null,
          source: "Xero Readiness",
          href: "/settings",
          target: {
            property_id: issue.property_id,
            tenancy_unit_id: issue.tenancy_unit_id,
            lease_id: issue.lease_id,
            tenant_id: issue.tenant_id,
            document_intake_id: null,
            obligation_id: null,
            billing_draft_id: null,
            invoice_draft_id: null,
          },
          rank: index + 1,
        })),
      ],
      automation_activity: [
        {
          id: "activity-1",
          occurred_at: "2026-05-19T10:00:00.000Z",
          kind: "smart_intake_apply",
          label: "Apply document intake",
          detail: "Created reviewed lease records from Smart Intake.",
          source: "smart_intake_apply",
          target_table: "document_intake",
          target_id: "intake-1",
          outcome: "success",
        },
      ],
      billing_risk: {
        ready_to_bill_count: chargeTaxType ? 1 : 0,
        blocked_row_count: chargeTaxType ? 0 : 1,
        blocker_count: chargeTaxType ? 0 : 1,
        configured_charges_cents: 800000,
        billing_draft_counts: { approved: 1 },
        invoice_draft_counts: { ready_for_approval: 1 },
        xero_issue_count: xero.issues.length,
        xero_blocker_count: xero.issues.filter(
          (issue) => issue.severity === "blocker",
        ).length,
        approved_unsynced_invoice_count: 1,
        unpaid_invoice_count: 1,
      },
      finance_snapshot: {
        configured_charges_cents: 800000,
        ready_to_bill_count: chargeTaxType ? 1 : 0,
        blocked_row_count: chargeTaxType ? 0 : 1,
        approved_unsynced_invoice_count: 1,
        unpaid_invoice_count: 1,
        billing_draft_counts: { approved: 1 },
        invoice_draft_counts: { ready_for_approval: 1 },
        accounting_readiness: accountingReadiness,
      },
      owner_entity_snapshot: {
        ownership_profile_counts: { trust: 1 },
        missing_invoice_issuer_count: 0,
        missing_owner_abn_count: 0,
        missing_trustee_count: 0,
        missing_ownership_split_count: 0,
        missing_xero_contact_count: 0,
        entity_gst_registered: true,
        xero_connected: Boolean(xeroTenantId),
        xero_last_sync_at: null,
        accounting_readiness: accountingReadiness,
      },
      lease_event_snapshot: {
        active_lease_count: 1,
        next_review_count: 1,
        next_expiry_count: 0,
        overdue_obligation_count: 0,
        due_soon_obligation_count: 1,
        tenant_onboarding_waiting_count: 1,
        next_events: [
          {
            id: `rent-review-${leaseId}`,
            kind: "rent_review",
            title:
              "Bright Cafe Pty Ltd rent review - Queen Street Retail Centre, Shop 3",
            date: "2026-07-01",
            chip: "01 Jul 2026",
            href: "/properties",
            target: {
              property_id: propertyId,
              tenancy_unit_id: unitId,
              lease_id: leaseId,
              tenant_id: tenantId,
              document_intake_id: null,
              obligation_id: null,
              billing_draft_id: null,
              invoice_draft_id: null,
            },
            rank: 43,
          },
        ],
      },
      guardrails: [
        "Insights is read-only and does not mutate portfolio records.",
        "Billing and Xero risk counts come from readiness checks; no invoice posting or sync runs here.",
        "Automation activity is summarized from audit logs without exposing tool inputs.",
      ],
    };
  };

  await page.route("https://images.example/**", async (route) => {
    await route.fulfill({
      body: tinyPropertyImagePng,
      contentType: "image/png",
      status: 200,
    });
  });

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, "");

    if (method === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    if (method === "GET" && path === "/entities") {
      await fulfillJson(
        route,
        entities.map((entity) => ({
          ...entity,
          xero_tenant_id: xeroTenantId,
          xero_connected_at: xeroConnectedAt,
        })),
      );
      return;
    }

    if (method === "GET" && path === "/security/workspace") {
      await fulfillJson(route, securityWorkspace());
      return;
    }

    if (method === "GET" && path === "/security/bootstrap/status") {
      await fulfillJson(route, securityBootstrapStatus());
      return;
    }

    if (method === "GET" && path === "/xero/status") {
      await fulfillJson(route, xeroStatus());
      return;
    }

    if (method === "GET" && path === "/xero/connection-diagnostics") {
      await fulfillJson(route, xeroConnectionDiagnostics());
      return;
    }

    if (method === "GET" && path === "/system/integration-status") {
      await fulfillJson(route, {
        serpapi: {
          configured: true,
          label: "SerpAPI Google Images",
          purpose:
            "Property image candidate search (Properties > Property images)",
          detail:
            "Configured. Provider sends still require explicit reviewed actions.",
        },
        openai: {
          configured: true,
          label: "OpenAI",
          purpose:
            "Public field enrichment (Properties/Tenants > Suggest missing values)",
          detail:
            "Configured. Provider sends still require explicit reviewed actions.",
        },
        sendgrid: {
          configured: false,
          label: "SendGrid",
          purpose:
            "Email delivery (invoice, contractor, Work notifications, digests)",
          detail:
            "Set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL on the API service to enable provider sends. Without them, provider attempts are recorded as skipped.",
        },
        twilio: {
          configured: false,
          label: "Twilio Messaging",
          purpose: "SMS delivery (Work notifications, contractor SMS)",
          detail:
            "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_MESSAGING_SERVICE_SID on the API service to enable SMS sends.",
        },
        xero: {
          configured: true,
          label: "Xero",
          purpose:
            "Accounting sync (contact, chart/tax, invoice posting, payments)",
          detail:
            "Configured. Provider sends still require explicit reviewed actions.",
        },
      });
      return;
    }

    if (method === "GET" && path === "/comms/queue") {
      await fulfillJson(route, {
        entity_id: entityId,
        generated_at: "2026-05-27T02:00:00.000Z",
        candidates: [
          {
            id: "comms-inbound-sms-1",
            kind: "inbound_sms",
            target_kind: "inbound_message",
            target_id: "inbound-sms-1",
            tenant_id: tenantId,
            tenant_name: "Bright Cafe Pty Ltd",
            property_name: "Queen Street Retail Centre",
            unit_label: "Shop 3",
            recipient_email: null,
            recipient_phone: "+61400111222",
            subject: "SMS reply to Bright Cafe Pty Ltd",
            body: "Thanks for the update. We have logged this and will follow up shortly.",
            severity: "warning",
            due_at: "2026-05-27T05:00:00.000Z",
            detail: "AI: maintenance request (82%)",
            generated_at: "2026-05-27T02:00:00.000Z",
          },
          {
            id: "comms-rent-review-1",
            kind: "rent_review",
            target_kind: "lease",
            target_id: leaseId,
            tenant_id: tenantId,
            tenant_name: "Bright Cafe Pty Ltd",
            property_name: "Queen Street Retail Centre",
            unit_label: "Shop 3",
            recipient_email: "tenant@example.com",
            recipient_phone: null,
            subject: "Upcoming rent review",
            body: "Your lease rent review is coming up. Please reply if you need anything clarified.",
            severity: "info",
            due_at: "2026-07-01T00:00:00.000Z",
            detail: "+3% fixed increase",
            generated_at: "2026-05-27T02:00:00.000Z",
          },
        ],
      });
      return;
    }

    if (method === "GET" && path === "/comms/queue/counts") {
      await fulfillJson(route, {
        entity_id: entityId,
        total: 2,
        urgent: 0,
        by_kind: {
          arrears_reminder: 0,
          insurance_expiry: 0,
          lease_renewal: 0,
          inbound_email: 0,
          inbound_sms: 1,
          compliance_obligation: 0,
          rent_review: 1,
        },
        generated_at: "2026-05-27T02:00:00.000Z",
      });
      return;
    }

    if (method === "POST" && path === "/comms/dispatch") {
      const payload = request.postDataJSON() as {
        kind?: string;
        target_kind?: string;
        target_id?: string;
        recipient_email?: string | null;
        recipient_phone?: string | null;
      };
      await fulfillJson(route, {
        candidate_id:
          payload.kind === "inbound_sms"
            ? "comms-inbound-sms-1"
            : "comms-rent-review-1",
        kind: payload.kind ?? "rent_review",
        target_kind: payload.target_kind ?? "lease",
        target_id: payload.target_id ?? leaseId,
        channel: payload.kind === "inbound_sms" ? "sms" : "email",
        status: "skipped",
        provider: payload.kind === "inbound_sms" ? "twilio" : "sendgrid",
        recipient:
          payload.kind === "inbound_sms"
            ? (payload.recipient_phone ?? null)
            : (payload.recipient_email ?? null),
        provider_message_id: null,
        error:
          payload.kind === "inbound_sms"
            ? "Twilio Messaging is not configured."
            : "SendGrid is not configured.",
        sent_at: "2026-05-27T02:05:00.000Z",
      });
      return;
    }

    if (method === "POST" && path === "/comms/dismiss") {
      const payload = request.postDataJSON() as {
        kind?: string;
        target_kind?: string;
        target_id?: string;
      };
      await fulfillJson(route, {
        candidate_id:
          payload.kind === "inbound_sms"
            ? "comms-inbound-sms-1"
            : "comms-rent-review-1",
        kind: payload.kind ?? "rent_review",
        target_kind: payload.target_kind ?? "lease",
        target_id: payload.target_id ?? leaseId,
        deferred_until: "2026-06-03T02:05:00.000Z",
        reason: null,
        dismissed_at: "2026-05-27T02:05:00.000Z",
      });
      return;
    }

    if (method === "GET" && path === "/xero/exception-queue") {
      await fulfillJson(route, xeroExceptionQueue());
      return;
    }

    if (method === "GET" && path === "/activity-feed") {
      await fulfillJson(route, {
        items: [
          {
            id: "0193a000-0000-7000-a000-000000000001",
            occurred_at: new Date(Date.now() - 5 * 60_000).toISOString(),
            actor: "Temba van Jaarsveld",
            actor_kind: "operator",
            action: "approve",
            action_kind: "approve",
            action_label: "Approved",
            summary: "Approved invoice INV-1001 for May rent and outgoings.",
            target_table: "invoice_draft",
            target_id: "0193a000-0000-7000-b000-000000000001",
            target_label: "INV-1001",
            target_href: "/billing-readiness",
            tool_name: null,
            outcome: "success",
            error_message: null,
          },
          {
            id: "0193a000-0000-7000-a000-000000000002",
            occurred_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
            actor: "Temba van Jaarsveld",
            actor_kind: "operator",
            action: "apply",
            action_kind: "apply",
            action_label: "Applied",
            summary:
              "Applied Smart Intake review for May rent schedule (4 charges).",
            target_table: "document_intake",
            target_id: "0193a000-0000-7000-c000-000000000001",
            target_label: "May Rent Schedule",
            target_href: "/intake",
            tool_name: null,
            outcome: "success",
            error_message: null,
          },
          {
            id: "0193a000-0000-7000-a000-000000000003",
            occurred_at: new Date(Date.now() - 26 * 3600_000).toISOString(),
            actor: "System",
            actor_kind: "system",
            action: "reminder",
            action_kind: "remind",
            action_label: "Reminded",
            summary:
              "Sent overdue insurance certificate reminder to Queen Street Retail Centre.",
            target_table: "obligation",
            target_id: "0193a000-0000-7000-d000-000000000001",
            target_label: "Insurance certificate renewal",
            target_href: "/operations",
            tool_name: null,
            outcome: "success",
            error_message: null,
          },
        ],
        has_more: false,
        next_cursor: null,
      });
      return;
    }

    if (method === "POST" && path === "/ai/triage") {
      await fulfillJson(route, {
        kind: "maintenance_request",
        confidence: 0.88,
        summary: "Tenant reports a slow kitchen tap leak.",
        suggested_action: "Open the maintenance queue and triage.",
        suggested_target_kind: "maintenance_work_order",
        suggested_target_href: "/operations",
        suggested_property: {
          id: "11111111-1111-1111-1111-111111111111",
          label: "Queen Street Retail Centre — 28 Queen Street",
        },
        suggested_tenant: {
          id: "22222222-2222-2222-2222-222222222222",
          label: "Acme Bakery",
        },
        suggested_lease: null,
        suggested_contractor: null,
        key_facts: [
          { label: "Property", value: "28 Queen Street" },
          { label: "Severity", value: "Non-urgent" },
        ],
        warnings: [],
        guardrails: [
          "Inbox triage is read-only. It suggests where to take the message next; it never creates or sends anything on its own.",
        ],
        response_id: "resp_triage_smoke",
      });
      return;
    }

    if (method === "POST" && path === "/ai/triage/promote") {
      const requestBody = route.request().postDataJSON() as {
        kind?: string;
      } | null;
      if (requestBody?.kind === "tenant_contact") {
        await fulfillJson(route, {
          target_kind: "tenant",
          target_id: "22222222-2222-2222-2222-222222222222",
          target_href: "/tenants/22222222-2222-2222-2222-222222222222",
          target_label: "Acme Bakery",
        });
        return;
      }
      await fulfillJson(route, {
        target_kind: "maintenance_work_order",
        target_id: "99999999-9999-9999-9999-999999999999",
        target_href:
          "/operations/maintenance/99999999-9999-9999-9999-999999999999",
        target_label: "Tenant reports a slow kitchen tap leak.",
      });
      return;
    }

    if (method === "POST" && path === "/ai/triage/tenant-contact-preview") {
      await fulfillJson(route, {
        tenant: {
          id: "22222222-2222-2222-2222-222222222222",
          label: "Acme Bakery",
        },
        summary: "Tenant asked to update billing contact details.",
        confidence: 0.86,
        proposed_updates: [
          {
            field: "contact_email",
            label: "Contact email",
            current_value: "tenant@acmebakery.example",
            proposed_value: "accounts@acmebakery.example",
            selected_by_default: true,
          },
          {
            field: "contact_phone",
            label: "Phone",
            current_value: null,
            proposed_value: "0411 222 333",
            selected_by_default: true,
          },
        ],
        warnings: [],
        guardrails: [
          "Tenant-contact extraction is read-only. It proposes contact-detail changes for operator review; it does not email tenants or change records by itself.",
        ],
        response_id: "resp_tenant_contact_smoke",
      });
      return;
    }

    if (method === "POST" && path === "/ai/ask") {
      await fulfillJson(route, {
        answer:
          "1 lease expires within the next 90 days: Queen Street Retail Centre on 2026-07-15.",
        citations: [
          {
            kind: "property",
            target_id: "11111111-1111-1111-1111-111111111111",
            label: "Queen Street Retail Centre",
            href: "/properties?property_id=11111111-1111-1111-1111-111111111111",
          },
        ],
        warnings: [],
        guardrails: [
          "Read-only: Leasium will not send messages, post invoices, or change records based on this answer.",
          "Verify amounts and dates against the linked record before acting.",
        ],
        response_id: "resp_smoke_ask",
      });
      return;
    }

    if (method === "GET" && path === "/xero/oauth/start") {
      xeroTenantId = xeroTenantId ?? "tenant-smoke";
      xeroConnectedAt = xeroConnectedAt ?? "2026-05-19T10:00:00.000Z";
      xeroProviderConnected = true;
      await fulfillJson(route, {
        configured: true,
        authorization_url: null,
        missing_config: [],
        redirect_uri: "http://localhost:8000/api/v1/xero/oauth/callback",
        scopes: [
          "offline_access",
          "accounting.contacts.read",
          "accounting.settings.read",
          "accounting.invoices",
        ],
        state_expires_at: "2026-05-19T10:15:00.000Z",
      });
      return;
    }

    if (method === "GET" && path === "/insights/overview") {
      await fulfillJson(route, insightsOverview());
      return;
    }

    if (method === "POST" && path === "/register-imports/dry-run") {
      await fulfillJson(route, registerImportDryRun());
      return;
    }

    if (method === "GET" && path === "/register-imports/template") {
      await route.fulfill({
        body: migrationTemplateXlsx,
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers: {
          ...corsHeaders,
          "content-disposition":
            'attachment; filename="leasium-migration-template.xlsx"',
        },
        status: 200,
      });
      return;
    }

    if (method === "POST" && path === "/register-imports/apply") {
      const payload = request.postDataJSON() as {
        approved_action_ids?: string[];
        ignored_action_ids?: string[];
        filename?: string;
      };
      const approved = payload.approved_action_ids ?? [];
      await fulfillJson(route, {
        entity_id: entityId,
        filename: payload.filename ?? "portfolio-import.xlsx",
        applied_at: "2026-05-21T01:00:00.000Z",
        requested: approved.length,
        applied: approved.length,
        skipped: payload.ignored_action_ids?.length ?? 0,
        blocked: approved.includes("register-action-3") ? 1 : 0,
        created: {
          properties: approved.includes("register-action-1") ? 1 : 0,
          tenants: 0,
          leases: 0,
        },
        updated: {
          tenants: approved.includes("register-action-2") ? 1 : 0,
        },
        ignored_action_ids: payload.ignored_action_ids ?? [],
        results: approved.map((actionId) => ({
          action_id: actionId,
          target: actionId === "register-action-2" ? "tenant" : "property",
          operation: actionId === "register-action-2" ? "update" : "create",
          status: "applied",
          message: "Applied reviewed register action.",
          target_table:
            actionId === "register-action-2" ? "tenant" : "property",
          target_id: `${actionId}-target`,
          created: actionId === "register-action-1" ? { properties: 1 } : {},
          updated: actionId === "register-action-2" ? { tenants: 1 } : {},
        })),
      });
      return;
    }

    if (method === "POST" && path === "/insights/snapshots") {
      const payload = request.postDataJSON() as {
        snapshot_type?: string;
        as_of?: string;
      };
      snapshotCount += 1;
      const token = `snapshot-token-${snapshotCount}`;
      const snapshot = {
        id: `snapshot-${snapshotCount}`,
        entity_id: entityId,
        snapshot_type: payload.snapshot_type ?? "owner",
        as_of: payload.as_of ?? "2026-05-19",
        created_at: "2026-05-19T10:00:00.000Z",
        expires_at: "2026-06-18T10:00:00.000Z",
        revoked_at: null,
        payload: insightsOverview(),
        share_url: null,
      };
      insightSnapshots = [snapshot, ...insightSnapshots];
      await fulfillJson(
        route,
        {
          ...snapshot,
          token,
          share_url: `/snapshots/${token}`,
        },
        201,
      );
      return;
    }

    if (method === "GET" && path === "/insights/snapshots") {
      await fulfillJson(route, insightSnapshots);
      return;
    }

    if (method === "GET" && path.startsWith("/insights/snapshots/public/")) {
      const token = path.split("/").pop();
      const tokenIndex = Number(token?.replace("snapshot-token-", "")) - 1;
      const snapshot = insightSnapshots[tokenIndex] as
        | { [key: string]: JsonBody }
        | undefined;
      if (!snapshot || snapshot.revoked_at) {
        await fulfillJson(
          route,
          { detail: "Insights snapshot not found." },
          404,
        );
        return;
      }
      await fulfillJson(route, {
        id: snapshot.id,
        snapshot_type: snapshot.snapshot_type,
        as_of: snapshot.as_of,
        created_at: snapshot.created_at,
        expires_at: snapshot.expires_at,
        payload: snapshot.payload,
        guardrails: [
          "This is a frozen snapshot, not a live portfolio connection.",
          "The public link cannot mutate Leasium records.",
        ],
      });
      return;
    }

    if (
      method === "POST" &&
      path.startsWith("/insights/snapshots/") &&
      path.endsWith("/revoke")
    ) {
      const snapshotId = path.split("/").at(-2);
      insightSnapshots = insightSnapshots.map((snapshot) => {
        const row = snapshot as { [key: string]: JsonBody };
        if (row.id === snapshotId) {
          return { ...row, revoked_at: "2026-05-19T10:30:00.000Z" };
        }
        return row;
      });
      const revoked = insightSnapshots.find(
        (snapshot) =>
          (snapshot as { [key: string]: JsonBody }).id === snapshotId,
      );
      await fulfillJson(
        route,
        revoked ?? { detail: "Insights snapshot not found." },
      );
      return;
    }

    if (method === "PATCH" && path === `/xero/connection/${entityId}`) {
      const payload = request.postDataJSON() as {
        connected?: boolean;
        xero_tenant_id?: string | null;
      };
      if (payload.connected === false) {
        xeroTenantId = null;
        xeroConnectedAt = null;
        xeroProviderConnected = false;
      } else {
        xeroTenantId = payload.xero_tenant_id ?? "tenant-smoke";
        xeroConnectedAt = "2026-05-19T10:00:00.000Z";
        xeroProviderConnected = false;
      }
      await fulfillJson(route, xeroConnection());
      return;
    }

    if (
      method === "POST" &&
      path === `/xero/contacts/sync-preview/${entityId}`
    ) {
      xeroTenantId = xeroTenantId ?? "tenant-smoke";
      xeroConnectedAt = xeroConnectedAt ?? "2026-05-19T10:00:00.000Z";
      xeroProviderConnected = true;
      const brightCafeMapping = appliedContactMappings.find(
        (mapping) =>
          mapping.target_type === "tenant" && mapping.target_id === tenantId,
      );
      await fulfillJson(route, {
        entity_id: entityId,
        xero_tenant_id: xeroTenantId,
        tenant_name: "Demo Xero Org",
        fetched_contacts: 2,
        suggested_matches: [
          {
            target_type: "tenant",
            target_id: tenantId,
            target_name: "Bright Cafe",
            current_xero_contact_id: brightCafeMapping?.xero_contact_id ?? null,
            xero_contact_id: "contact-bright-cafe",
            xero_contact_name: "Bright Cafe",
            xero_email: "accounts@bright.example",
            match_reason: "billing/contact email matched",
            confidence: 0.94,
          },
        ],
        last_contact_sync_at: "2026-05-19T10:05:00.000Z",
        guardrails: [
          "This is a preview only; tenant and property Xero contact IDs were not changed.",
          "Invoice posting and payment reconciliation are still blocked behind future approvals.",
        ],
      });
      return;
    }

    if (
      method === "POST" &&
      path === `/xero/contacts/apply-preview/${entityId}`
    ) {
      const payload = request.postDataJSON() as {
        mappings?: Partial<XeroContactMapping>[];
      };
      const appliedAt = "2026-05-19T10:10:00.000Z";
      const appliedMappings: XeroContactMapping[] = [];
      const skippedMappings: JsonBody[] = [];

      for (const mapping of payload.mappings ?? []) {
        if (
          (mapping.target_type === "tenant" ||
            mapping.target_type === "property") &&
          mapping.target_id &&
          mapping.xero_contact_id
        ) {
          const appliedMapping: XeroContactMapping = {
            target_type: mapping.target_type,
            target_id: mapping.target_id,
            target_name: mapping.target_name ?? mapping.target_id,
            xero_contact_id: mapping.xero_contact_id,
            xero_contact_name:
              mapping.xero_contact_name ?? mapping.xero_contact_id,
            xero_email: mapping.xero_email ?? null,
          };
          appliedMappings.push(appliedMapping);
          continue;
        }
        skippedMappings.push({
          target_type:
            mapping.target_type === "tenant" ||
            mapping.target_type === "property"
              ? mapping.target_type
              : "tenant",
          target_id: mapping.target_id ?? "unknown",
          target_name: mapping.target_name ?? "Unknown target",
          previous_xero_contact_id: null,
          xero_contact_id: mapping.xero_contact_id ?? "unknown",
          xero_contact_name: mapping.xero_contact_name ?? "Unknown contact",
          status: "skipped",
          reason: "Mapping needs a tenant/property target and Xero contact ID.",
        });
      }

      appliedContactMappings = [
        ...appliedMappings,
        ...appliedContactMappings.filter(
          (existing) =>
            !appliedMappings.some(
              (mapping) =>
                mapping.target_type === existing.target_type &&
                mapping.target_id === existing.target_id,
            ),
        ),
      ];

      await fulfillJson(route, {
        entity_id: entityId,
        applied_mappings: appliedMappings.map((mapping) => ({
          ...mapping,
          previous_xero_contact_id: null,
          status: "applied",
          reason: "Reviewed mapping was saved locally.",
        })),
        skipped_mappings: skippedMappings,
        guardrails: [
          "Only reviewed tenant/property contact IDs were updated locally.",
          "No invoice posting, tenant email, or payment reconciliation was run.",
          "Provider contacts can be re-previewed before future approval actions.",
        ],
        applied_at: appliedAt,
      });
      return;
    }

    if (
      method === "POST" &&
      path === `/xero/chart-tax/validate-preview/${entityId}`
    ) {
      xeroTenantId = xeroTenantId ?? "tenant-smoke";
      xeroConnectedAt = xeroConnectedAt ?? "2026-05-19T10:00:00.000Z";
      xeroProviderConnected = true;
      await fulfillJson(route, xeroChartTaxValidationPreview());
      return;
    }

    if (
      method === "POST" &&
      path === `/xero/invoices/posting-preview/${entityId}`
    ) {
      xeroTenantId = xeroTenantId ?? "tenant-smoke";
      xeroConnectedAt = xeroConnectedAt ?? "2026-05-19T10:00:00.000Z";
      xeroProviderConnected = true;
      await fulfillJson(route, xeroInvoicePostingPreview());
      return;
    }

    if (
      method === "POST" &&
      path === "/xero/invoices/invoice-draft-1/posting-approval"
    ) {
      const payload = (await route.request().postDataJSON()) as {
        approved?: boolean;
      };
      xeroDraftApproved = payload.approved !== false;
      markXeroApproval(xeroDraftApproved);
      await fulfillJson(route, {
        invoice_draft_id: "invoice-draft-1",
        invoice_number: "INV-1001",
        status: xeroDraftApproved ? "approved" : "revoked",
        approval_state: xeroDraftApproved ? "approved" : "revoked",
        xero_sync_allowed: xeroDraftApproved,
        external_posting_status: xeroDraftApproved
          ? "approved_pending_xero_draft"
          : "approval_revoked",
        approved_at: xeroDraftApproved ? "2026-05-19T10:25:00.000Z" : null,
        idempotency_key: xeroDraftApproved
          ? "xero-draft-invoice-draft-1"
          : null,
        reason: xeroDraftApproved
          ? "Xero draft posting was explicitly approved locally."
          : "Xero draft posting approval was revoked locally.",
        guardrails: [
          "This endpoint only records local posting approval.",
          "No Xero invoice is created until the separate draft creation endpoint is called.",
          "Draft creation still requires an active configured provider connection.",
        ],
      });
      return;
    }

    if (
      method === "POST" &&
      path === `/xero/invoices/draft-create/${entityId}`
    ) {
      if (xeroDraftApproved) {
        xeroDraftCreated = true;
        markXeroDraftCreated("2026-05-19T10:30:00.000Z");
      }
      await fulfillJson(route, {
        entity_id: entityId,
        provider_configured: true,
        provider_connection_id: "xero-connection-1",
        xero_tenant_id: xeroTenantId ?? "tenant-smoke",
        checked_invoices: 1,
        created_count: xeroDraftApproved && xeroDraftCreated ? 1 : 0,
        skipped_count: 0,
        blocked_count: xeroDraftApproved ? 0 : 1,
        failed_count: 0,
        results: [
          {
            invoice_draft_id: "invoice-draft-1",
            invoice_number: "INV-1001",
            status: xeroDraftApproved ? "created" : "blocked",
            reason: xeroDraftApproved
              ? "Xero draft invoice was created after explicit approval."
              : "Explicit Xero posting approval is required before any Xero mutation.",
            approval_state: xeroDraftApproved ? "approved" : "missing",
            idempotency_key: "xero-draft-invoice-draft-1",
            xero_invoice_id: xeroDraftApproved ? "xero-invoice-smoke-1" : null,
            xero_status: xeroDraftApproved ? "DRAFT" : null,
            external_posting_status: xeroDraftApproved
              ? "draft_created"
              : "approval_required",
          },
        ],
        applied_at: "2026-05-19T10:30:00.000Z",
        guardrails: [
          "Xero draft creation only runs for invoice drafts with explicit local posting approval.",
          "When provider credentials or provider connection are absent, invoices are skipped safely.",
          "Successful Xero draft references are stored locally and repeated calls are idempotent.",
        ],
      });
      return;
    }

    if (
      method === "POST" &&
      path === `/xero/invoices/provider-dispatch/${entityId}`
    ) {
      const dispatchedAt = "2026-05-19T10:35:00.000Z";
      const xeroStatusValue = xeroDraftApproved
        ? xeroDraftCreated
          ? "reused"
          : "created"
        : "blocked";
      if (xeroDraftApproved && !xeroDraftCreated) {
        xeroDraftCreated = true;
        markXeroDraftCreated(dispatchedAt);
      }
      if (xeroDraftApproved) {
        markInvoiceProviderEmailSent(dispatchedAt);
      }
      const metadata = activeInvoiceMetadata();
      const providerReceipts = Array.isArray(metadata.provider_status_receipts)
        ? metadata.provider_status_receipts
        : [];
      await fulfillJson(route, {
        entity_id: entityId,
        provider_configured: true,
        provider_connection_id: "xero-connection-1",
        xero_tenant_id: xeroTenantId ?? "tenant-smoke",
        checked_invoices: 1,
        xero_created_count: xeroStatusValue === "created" ? 1 : 0,
        xero_reused_count: xeroStatusValue === "reused" ? 1 : 0,
        email_sent_count: xeroDraftApproved ? 1 : 0,
        email_reused_count: 0,
        blocked_count: xeroDraftApproved ? 0 : 1,
        failed_count: 0,
        dispatched_at: dispatchedAt,
        results: [
          {
            invoice_draft_id: "invoice-draft-1",
            invoice_number: "INV-1001",
            xero_status: xeroStatusValue,
            xero_reason: xeroDraftApproved
              ? xeroStatusValue === "reused"
                ? "Invoice draft already has a Xero draft reference."
                : "Xero draft invoice was created after explicit approval."
              : "Explicit Xero posting approval is required before provider dispatch.",
            xero_invoice_id: xeroDraftApproved ? "xero-invoice-smoke-1" : null,
            xero_provider_status: xeroDraftApproved ? "DRAFT" : null,
            xero_idempotency_key: xeroDraftApproved
              ? "xero-draft-invoice-draft-1"
              : null,
            email_status: xeroDraftApproved ? "sent" : "skipped",
            email_reason: xeroDraftApproved
              ? "SendGrid queued the prepared invoice email."
              : "Tenant email waits until a Xero draft exists or is reused.",
            email_provider_status: xeroDraftApproved ? "queued" : null,
            email_provider_message_id: xeroDraftApproved
              ? "sg-dispatch-smoke-1"
              : null,
            provider_receipts: providerReceipts,
            next_action: xeroDraftApproved ? null : "resolve_xero_blockers",
          },
        ],
        guardrails: [
          "Provider dispatch creates or reuses an approved Xero DRAFT before tenant email.",
          "SendGrid email is reused when a successful provider receipt already exists.",
          "Payment reconciliation remains a separate reviewed action.",
        ],
      });
      return;
    }

    if (
      method === "POST" &&
      path === `/xero/payments/reconciliation-preview/${entityId}`
    ) {
      await fulfillJson(route, xeroPaymentReconciliationResult(false));
      return;
    }

    if (
      method === "POST" &&
      path === `/xero/payments/reconciliation-apply/${entityId}`
    ) {
      markInvoicePaymentReconciled("2026-05-19T10:42:00.000Z");
      await fulfillJson(route, xeroPaymentReconciliationResult(true));
      return;
    }

    if (method === "GET" && path === `/premises/by-entity/${entityId}`) {
      await fulfillJson(route, properties);
      return;
    }

    const premisePatchMatch = path.match(/^\/premises\/([^/]+)$/);
    if (method === "PATCH" && premisePatchMatch) {
      const propertyIndex = properties.findIndex(
        (property) => property.id === premisePatchMatch[1],
      );
      if (propertyIndex >= 0) {
        const payload = request.postDataJSON() as Record<string, JsonBody>;
        const updated = {
          ...properties[propertyIndex],
          ...payload,
        } as (typeof properties)[number];
        properties.splice(propertyIndex, 1, updated);
        await fulfillJson(route, updated);
        return;
      }
    }

    if (
      method === "GET" &&
      path === `/documents/${propertyImageDocumentId}/download`
    ) {
      await route.fulfill({
        body: tinyPropertyImagePng,
        contentType: "image/png",
        headers: corsHeaders,
        status: 200,
      });
      return;
    }

    if (
      method === "POST" &&
      path === "/public-enrichment/property-images/preview"
    ) {
      const payload = request.postDataJSON() as Record<string, JsonBody>;
      const requestedPropertyId =
        typeof payload.property_id === "string"
          ? payload.property_id
          : propertyId;
      const property =
        properties.find((item) => item.id === requestedPropertyId) ??
        properties[0];
      await fulfillJson(route, {
        target: {
          target_type: "property",
          target_id: property.id,
          entity_id: property.entity_id,
          display_name: property.name,
          missing_fields: [],
        },
        candidates: [
          {
            title: "Queen Street awning frontage",
            image_url: "https://images.example/queen-street-awning.jpg",
            page_url: "https://example.com/queen-street-awning",
            source: {
              source_hint: "Agency listing",
              citation: "Retail centre listing hero image.",
              confidence: 0.88,
              url: "https://example.com/queen-street-awning",
            },
            confidence: 0.88,
            notes: "Best exterior match.",
          },
          {
            title: "Queen Street corner view",
            image_url: "https://images.example/queen-street-corner.jpg",
            page_url: "https://example.com/queen-street-corner",
            source: {
              source_hint: "Commercial brochure",
              citation: "Retail centre brochure exterior photo.",
              confidence: 0.74,
              url: "https://example.com/queen-street-corner",
            },
            confidence: 0.74,
            notes: "Secondary exterior match.",
          },
        ],
        warnings: [],
        provider_response_id: "serpapi_property_images_1",
      });
      return;
    }

    if (
      method === "POST" &&
      path === "/public-enrichment/property-images/apply"
    ) {
      const payload = request.postDataJSON() as Record<string, JsonBody>;
      const candidate = payload.candidate as Record<string, JsonBody>;
      const requestedPropertyId =
        typeof payload.property_id === "string"
          ? payload.property_id
          : propertyId;
      const property = properties.find(
        (item) => item.id === requestedPropertyId,
      );
      if (property) {
        property.metadata = {
          ...property.metadata,
          property_media: {
            ...((property.metadata.property_media as Record<
              string,
              JsonBody
            >) ?? {}),
            primary_image: {
              ...candidate,
              document_id: propertyImageDocumentId,
              image_document_id: propertyImageDocumentId,
              thumbnail_document_id: propertyImageDocumentId,
              selected_at: "2026-05-20T01:00:00.000Z",
            },
          },
        };
      }
      await fulfillJson(route, {
        target: {
          target_type: "property",
          target_id: property?.id ?? requestedPropertyId,
          entity_id: property?.entity_id ?? entityId,
          display_name: property?.name ?? "Selected property",
          missing_fields: [],
        },
        selected_image: {
          ...candidate,
          document_id: propertyImageDocumentId,
          image_document_id: propertyImageDocumentId,
          thumbnail_document_id: propertyImageDocumentId,
        },
        document_id: propertyImageDocumentId,
        warnings: [],
      });
      return;
    }

    if (method === "GET" && path === "/tenants") {
      await fulfillJson(route, tenants);
      return;
    }

    const tenantPatchMatch = path.match(/^\/tenants\/([^/]+)$/);
    if (method === "PATCH" && tenantPatchMatch) {
      const tenantIndex = tenants.findIndex(
        (tenant) => tenant.id === tenantPatchMatch[1],
      );
      if (tenantIndex >= 0) {
        const payload = request.postDataJSON() as Record<string, JsonBody>;
        const updated = {
          ...tenants[tenantIndex],
          ...payload,
          updated_at: "2026-05-21T00:00:00.000Z",
        } as (typeof tenants)[number];
        tenants.splice(tenantIndex, 1, updated);
        await fulfillJson(route, updated);
        return;
      }
    }

    if (method === "GET" && path === `/tenants/${tenantId}`) {
      await fulfillJson(route, tenants[0]);
      return;
    }

    if (method === "GET" && path === `/tenants/${tenantId}/detail`) {
      await fulfillJson(route, {
        tenant: tenants[0],
        leases: [
          {
            lease_id: leaseId,
            status: "active",
            property_id: propertyId,
            property_name: "Queen Street Retail Centre",
            property_address: "12 Queen Street, Brisbane City, QLD, 4000",
            tenancy_unit_id: unitId,
            unit_label: "Shop 3",
            commencement_date: "2025-07-01",
            expiry_date: "2028-06-30",
            annual_rent_cents: 9600000,
            rent_frequency: "monthly",
            outgoings_recoverable: true,
            next_review_date: "2026-07-01",
          },
        ],
        activity: [
          {
            occurred_at: "2026-05-19T09:00:00.000Z",
            kind: "tenant_portal_account",
            label: "Portal account linked",
            detail: "mia@example.com",
            source: "tenant_portal_account",
            related_id: "portal-account-1",
            tone: "success",
          },
        ],
        reviewed_changes: [
          {
            occurred_at: "2026-05-19T09:30:00.000Z",
            source: "tenant_onboarding",
            source_label: "Tenant onboarding",
            source_id: "onboarding-1",
            status: "applied",
            notes: "Reviewed tenant onboarding submission.",
            changes: [
              {
                field: "billing_email",
                label: "Billing email",
                before: null,
                after: "accounts@bright.example",
              },
              {
                field: "contact_phone",
                label: "Phone",
                before: null,
                after: "0400 111 222",
              },
            ],
          },
        ],
      });
      return;
    }

    if (method === "GET" && path === `/tenants/${tenantId}/portal-accounts`) {
      await fulfillJson(route, operatorTenantPortalAccounts);
      return;
    }

    if (
      method === "POST" &&
      path === `/tenants/${tenantId}/portal-accounts/portal-account-1/revoke`
    ) {
      operatorTenantPortalAccounts = operatorTenantPortalAccounts.map(
        (account) =>
          account.id === "portal-account-1"
            ? {
                ...account,
                status: "revoked",
                revoked_at: "2026-05-20T00:00:00.000Z",
                updated_at: "2026-05-20T00:00:00.000Z",
                recovery_action: "revoked",
                recovery_reason:
                  "Operator revoked access from the tenant profile.",
                recovery_at: "2026-05-20T00:00:00.000Z",
              }
            : account,
      );
      await fulfillJson(route, operatorTenantPortalAccounts[0]);
      return;
    }

    if (
      method === "POST" &&
      path === `/tenants/${tenantId}/portal-accounts/portal-account-1/restore`
    ) {
      operatorTenantPortalAccounts = operatorTenantPortalAccounts.map(
        (account) =>
          account.id === "portal-account-1"
            ? {
                ...account,
                status: "active",
                revoked_at: null,
                updated_at: "2026-05-20T00:05:00.000Z",
                recovery_action: "restored",
                recovery_reason:
                  "Operator restored access from the tenant profile.",
                recovery_at: "2026-05-20T00:05:00.000Z",
              }
            : account,
      );
      await fulfillJson(route, operatorTenantPortalAccounts[0]);
      return;
    }

    if (
      method === "POST" &&
      path === `/tenants/${tenantId}/portal-accounts/portal-account-1/unlink`
    ) {
      const account =
        operatorTenantPortalAccounts[0] ??
        initialOperatorTenantPortalAccounts[0];
      operatorTenantPortalAccounts = [
        {
          ...account,
          status: "unlinked",
          deleted_at: "2026-05-20T00:00:00.000Z",
          updated_at: "2026-05-20T00:00:00.000Z",
          recovery_action: "unlinked",
          recovery_reason:
            "Operator unlinked access so the tenant can reconnect.",
          recovery_at: "2026-05-20T00:00:00.000Z",
        },
      ];
      await fulfillJson(route, {
        ...account,
        status: "unlinked",
        deleted_at: "2026-05-20T00:00:00.000Z",
        updated_at: "2026-05-20T00:00:00.000Z",
        recovery_action: "unlinked",
        recovery_reason:
          "Operator unlinked access so the tenant can reconnect.",
        recovery_at: "2026-05-20T00:00:00.000Z",
      });
      return;
    }

    if (method === "GET" && path === "/tenant-onboarding") {
      await fulfillJson(route, tenantOnboardings);
      return;
    }

    if (method === "POST" && path === "/tenant-onboarding") {
      const payload = request.postDataJSON() as {
        lease_id?: string;
        due_date?: string | null;
        expires_at?: string | null;
      };
      const row = rentRoll.find((item) => item.lease_id === payload.lease_id);
      const createdAt = "2026-05-21T00:05:00.000Z";
      const created = {
        id: `onboarding-${tenantOnboardings.length + 1}`,
        entity_id: entityId,
        lease_id: payload.lease_id ?? "lease-created",
        tenant_id: row?.tenant_id ?? tenantId,
        token: `tenant-token-${tenantOnboardings.length + 1}`,
        status: "draft",
        due_date: payload.due_date ?? "2026-05-28",
        expires_at: payload.expires_at ?? "2026-06-11T23:59:59+10:00",
        last_sent_at: null,
        resent_at: null,
        cancel_reason: null,
        onboarding_url: `http://127.0.0.1:3000/onboarding/tenant-token-${tenantOnboardings.length + 1}`,
        portal_url: `http://127.0.0.1:3000/tenant-portal/tenant-token-${tenantOnboardings.length + 1}`,
        submitted_data: {},
        submitted_at: null,
        review_data: {},
        delivery_data: {},
        created_at: createdAt,
        updated_at: createdAt,
        deleted_at: null,
      } as (typeof tenantOnboardings)[number];
      tenantOnboardings.push(created);
      await fulfillJson(route, created, 201);
      return;
    }

    if (
      method === "POST" &&
      path === "/tenant-onboarding/onboarding-1/fresh-link"
    ) {
      const refreshedAt = "2026-05-20T00:10:00.000Z";
      tenantOnboardings = tenantOnboardings.map((onboarding) =>
        onboarding.id === "onboarding-1"
          ? {
              ...onboarding,
              token: "tenant-token-fresh",
              expires_at: "2026-06-03T00:10:00.000Z",
              last_sent_at: refreshedAt,
              resent_at: refreshedAt,
              onboarding_url:
                "http://127.0.0.1:3000/onboarding/tenant-token-fresh",
              portal_url:
                "http://127.0.0.1:3000/tenant-portal/tenant-token-fresh",
              updated_at: refreshedAt,
              delivery_data: {
                ...onboarding.delivery_data,
                fresh_link: {
                  refreshed_at: refreshedAt,
                  reason:
                    "Operator sent a fresh portal link from the tenant profile.",
                  expires_in_days: 14,
                  expires_at: "2026-06-03T00:10:00.000Z",
                },
              },
            }
          : onboarding,
      );
      await fulfillJson(route, tenantOnboardings[0]);
      return;
    }

    if (
      method === "POST" &&
      path === "/tenant-onboarding/onboarding-1/send-portal-invite"
    ) {
      const sentAt = "2026-05-21T00:15:00.000Z";
      tenantOnboardings = tenantOnboardings.map((onboarding) =>
        onboarding.id === "onboarding-1"
          ? {
              ...onboarding,
              delivery_data: {
                ...onboarding.delivery_data,
                portal_invite: {
                  sent_at: sentAt,
                  sent_by_user_id: "user-temba",
                  template_key: "tenant_portal_invite",
                  template_version: "v1",
                  receipts: [
                    {
                      channel: "email",
                      status: "queued",
                      provider: "sendgrid",
                      recipient: "mi***@example.com",
                      provider_message_id: "portal-invite-msg-1",
                      error: null,
                      metadata: { template_key: "tenant_portal_invite" },
                    },
                  ],
                },
              },
              updated_at: sentAt,
            }
          : onboarding,
      );
      await fulfillJson(route, tenantOnboardings[0]);
      return;
    }

    if (
      method === "POST" &&
      path === "/tenant-onboarding/onboarding-1/send-lease-pack"
    ) {
      const sentAt = "2026-05-21T00:20:00.000Z";
      tenantOnboardings = tenantOnboardings.map((onboarding) =>
        onboarding.id === "onboarding-1"
          ? {
              ...onboarding,
              delivery_data: {
                ...onboarding.delivery_data,
                lease_pack: {
                  sent_at: sentAt,
                  sent_by_user_id: "user-temba",
                  template_key: "tenant_lease_pack",
                  template_version: "v1",
                  receipts: [
                    {
                      channel: "email",
                      status: "queued",
                      provider: "sendgrid",
                      recipient: "mi***@example.com",
                      provider_message_id: "lease-pack-msg-1",
                      error: null,
                      metadata: { template_key: "tenant_lease_pack" },
                    },
                  ],
                },
              },
              updated_at: sentAt,
            }
          : onboarding,
      );
      await fulfillJson(route, tenantOnboardings[0]);
      return;
    }

    if (method === "POST" && path === "/tenant-portal/onboarding/submit") {
      tenantPortalOnboardingSubmitted = true;
      const submittedAt = "2026-05-21T01:00:00.000Z";
      const baseSession = tenantPortalSession();
      await fulfillJson(route, {
        ...baseSession,
        onboarding: {
          ...baseSession.onboarding,
          status: "submitted",
          submitted_at: submittedAt,
          submitted_data: {
            legal_name: "Bright Cafe Pty Ltd",
            contact_name: "Mia Hart",
            contact_email: "mia@example.com",
            accepted: true,
          },
        },
      });
      return;
    }

    if (method === "GET" && path === "/tenant-portal/session") {
      const baseSession = tenantPortalSession();
      if (tenantPortalOnboardingSubmitted) {
        await fulfillJson(route, {
          ...baseSession,
          onboarding: {
            ...baseSession.onboarding,
            status: "submitted",
            submitted_at: "2026-05-21T01:00:00.000Z",
            submitted_data: {
              legal_name: "Bright Cafe Pty Ltd",
              contact_name: "Mia Hart",
              contact_email: "mia@example.com",
              accepted: true,
            },
          },
        });
        return;
      }
      await fulfillJson(route, baseSession);
      return;
    }

    if (
      method === "GET" &&
      /^\/tenant-portal\/invites\/[^/]+\/preview$/.test(path)
    ) {
      const baseSession = tenantPortalSession();
      await fulfillJson(route, {
        property_name: `${baseSession.lease.property_name} — ${baseSession.lease.unit_label}`,
        property_address: baseSession.lease.property_address,
        tenant_display_name:
          baseSession.tenant.trading_name ?? baseSession.tenant.legal_name,
        tenant_email: baseSession.tenant.contact_email,
        expires_at: baseSession.onboarding.expires_at,
        claimable: !tenantAccountLinked,
      });
      return;
    }

    if (
      method === "GET" &&
      path === "/tenant-portal/operator-preview/onboarding-1"
    ) {
      const baseSession = tenantPortalSession();
      await fulfillJson(route, {
        ...baseSession,
        auth: {
          mode: "operator_preview",
          token_source: "bearer",
          tenant_auth_configured: true,
          dev_fallback: false,
          boundary: "operator_session",
          detail:
            "Read-only operator preview scoped by the signed-in Leasium role. No tenant portal account is created.",
        },
        guardrails: [
          "Operator preview is read-only and does not create a tenant portal session.",
          "Only tenant-visible portal data is shown.",
          "Only approved invoice drafts are visible to tenants.",
        ],
      });
      return;
    }

    if (method === "GET" && path === "/tenant-portal/account/status") {
      if (!tenantAccountLinked) {
        await fulfillJson(route, {
          status: "unlinked",
          tenant_id: null,
          tenant_name: null,
          email: null,
          linked_at: null,
          last_seen_at: null,
          revoked_at: null,
          recovery_action: "unlinked",
          recovery_at: "2026-05-20T00:00:00.000Z",
          recovery_hint:
            "The property team unlinked this tenant login so it can be safely reconnected. Open a fresh tenant portal link once to relink this account.",
        });
        return;
      }
      await fulfillJson(route, {
        status: "active",
        tenant_id: tenantAccountLinkedToDifferentTenant
          ? "tenant-linked-elsewhere"
          : tenantId,
        tenant_name: tenantAccountLinkedToDifferentTenant
          ? "Riverfront Books"
          : "Bright Cafe",
        email: "mia@example.com",
        linked_at: "2026-05-19T09:00:00.000Z",
        last_seen_at: "2026-05-19T09:30:00.000Z",
        revoked_at: null,
        recovery_action: null,
        recovery_at: null,
        recovery_hint:
          "This tenant login can open the portal without the original link. If it is linked to the wrong tenant, ask the property team to unlink and relink the account.",
      });
      return;
    }

    if (method === "GET" && path === "/tenant-portal/account/session") {
      if (!tenantAccountLinked) {
        await fulfillJson(
          route,
          { detail: "Tenant portal account not found." },
          401,
        );
        return;
      }
      await fulfillJson(
        route,
        tenantPortalSession(
          "account",
          tenantAccountLinkedToDifferentTenant
            ? {
                tenantId: "tenant-linked-elsewhere",
                tradingName: "Riverfront Books",
                leaseReady: tenantPortalLeaseReady,
                leaseSigned: tenantPortalLeaseSigned,
              }
            : {
                leaseReady: tenantPortalLeaseReady,
                leaseSigned: tenantPortalLeaseSigned,
              },
        ),
      );
      return;
    }

    if (method === "POST" && path === "/tenant-portal/account/claim") {
      tenantAccountLinked = true;
      await fulfillJson(
        route,
        tenantPortalSession("account", {
          leaseReady: tenantPortalLeaseReady,
          leaseSigned: tenantPortalLeaseSigned,
        }),
      );
      return;
    }

    if (method === "POST" && path === "/tenant-portal/lease-questions") {
      const payload = request.postDataJSON() as Record<string, JsonBody>;
      const baseSession = tenantPortalSession("account", {
        leaseReady: tenantPortalLeaseReady,
        leaseSigned: tenantPortalLeaseSigned,
      });
      await fulfillJson(route, {
        ...baseSession,
        lease_agreement: {
          ...baseSession.lease_agreement,
          status: "questions_open",
          open_question_count: 1,
          questions: [
            {
              id: "lease-question-1",
              question:
                typeof payload.question === "string"
                  ? payload.question
                  : "Can you confirm the option period?",
              clause_reference:
                typeof payload.clause_reference === "string"
                  ? payload.clause_reference
                  : null,
              status: "open",
              answer: null,
              asked_at: "2026-05-21T01:40:00.000Z",
              asked_by_actor: "tenant",
              answered_at: null,
              answered_by_actor: null,
              answered_by_user_id: null,
              resolved_at: null,
            },
          ],
        },
      });
      return;
    }

    if (method === "POST" && path === "/tenant-portal/lease-agreement/sign") {
      tenantPortalLeaseSigned = true;
      await fulfillJson(
        route,
        tenantPortalSession("account", {
          leaseReady: true,
          leaseSigned: tenantPortalLeaseSigned,
        }),
      );
      return;
    }

    if (
      method === "PATCH" &&
      path === "/tenant-portal/notification-preferences"
    ) {
      const payload = request.postDataJSON() as Record<string, JsonBody>;
      const emailEnabled =
        typeof payload.email_enabled === "boolean"
          ? payload.email_enabled
          : tenantPortalNotificationPreferences.email_enabled;
      const smsEnabled =
        typeof payload.sms_enabled === "boolean"
          ? payload.sms_enabled
          : tenantPortalNotificationPreferences.sms_enabled;
      tenantPortalNotificationPreferences = {
        ...tenantPortalNotificationPreferences,
        email_enabled: emailEnabled,
        sms_enabled: smsEnabled,
        billing_email_enabled:
          typeof payload.billing_email_enabled === "boolean"
            ? payload.billing_email_enabled
            : tenantPortalNotificationPreferences.billing_email_enabled,
        compliance_reminders_enabled:
          typeof payload.compliance_reminders_enabled === "boolean"
            ? payload.compliance_reminders_enabled
            : tenantPortalNotificationPreferences.compliance_reminders_enabled,
        preferred_channel: tenantPortalPreferredChannel(
          emailEnabled,
          smsEnabled,
        ),
        updated_at: "2026-05-20T03:15:00.000Z",
      };
      await fulfillJson(route, tenantPortalNotificationPreferences);
      return;
    }

    if (method === "POST" && path === "/tenant-portal/documents") {
      const body = request.postDataBuffer()?.toString("utf8") ?? "";
      const uploaded = {
        id: `portal-document-upload-${++tenantPortalDocumentCount}`,
        lease_id: leaseId,
        tenant_onboarding_id: "onboarding-1",
        filename: multipartFilename(body),
        content_type: request
          .headers()
          ["content-type"]?.includes("multipart/form-data")
          ? null
          : (request.headers()["content-type"] ?? null),
        byte_size: request.postDataBuffer()?.byteLength ?? 0,
        category: multipartField(body, "category") ?? "other",
        notes: multipartField(body, "notes"),
        source: "tenant_portal",
        created_at: "2026-05-20T03:00:00.000Z",
      };
      tenantPortalDocuments.unshift(uploaded);
      await fulfillJson(route, uploaded, 201);
      return;
    }

    if (method === "POST" && path === "/tenant-portal/maintenance-requests") {
      const payload = request.postDataJSON() as Record<string, JsonBody>;
      const documentIds = jsonStringArray(payload.document_ids);
      const photoDocumentIds = jsonStringArray(payload.photo_document_ids);
      const created = {
        ...maintenanceWorkOrders[0],
        ...payload,
        id: "portal-work-order-created",
        entity_id: entityId,
        property_id: propertyId,
        tenancy_unit_id: unitId,
        tenant_id: tenantId,
        lease_id: leaseId,
        status: "requested",
        priority: String(payload.priority ?? "normal"),
        requested_at: "2026-05-20T03:00:00.000Z",
        contractor_name: null,
        contractor_email: null,
        contractor_phone: null,
        contractor_assigned_at: null,
        approval_required: false,
        approval_status: "not_required",
        approval_limit_cents: null,
        quote_amount_cents: null,
        approved_by_user_id: null,
        approved_at: null,
        approval_notes: null,
        source_document_id: null,
        invoice_draft_id: null,
        invoice_reference: null,
        invoice_amount_cents: null,
        source_reference:
          typeof payload.source_reference === "string"
            ? payload.source_reference
            : null,
        due_date: null,
        completed_at: null,
        notes: null,
        document_ids: documentIds,
        photo_document_ids: photoDocumentIds,
        metadata: {
          source: "tenant_portal",
          attached_document_ids: documentIds,
          attached_photo_document_ids: photoDocumentIds,
          activity_history: [
            {
              timestamp: "2026-05-20T03:00:00.000Z",
              actor: "tenant-portal:header:tenant-t",
              source: "tenant_portal",
              event: "tenant_submitted",
              summary: "Tenant submitted maintenance request.",
              status: "requested",
            },
          ],
        },
        created_at: "2026-05-20T03:00:00.000Z",
        updated_at: "2026-05-20T03:00:00.000Z",
        deleted_at: null,
      };
      maintenanceWorkOrders.unshift(created);
      await fulfillJson(
        route,
        {
          id: created.id,
          title: created.title,
          description: created.description,
          status: created.status,
          priority: created.priority,
          requested_at: created.requested_at,
          source_reference: created.source_reference,
          due_date: created.due_date,
          completed_at: created.completed_at,
          document_ids: created.document_ids,
          photo_document_ids: created.photo_document_ids,
          history: created.metadata.activity_history.map((entry) => ({
            timestamp: entry.timestamp,
            event: entry.event,
            summary: entry.summary,
            status: entry.status,
          })),
          created_at: created.created_at,
        },
        201,
      );
      return;
    }

    if (method === "GET" && path === "/obligations") {
      await fulfillJson(route, obligations);
      return;
    }

    if (method === "PATCH" && path === "/obligations/obligation-1") {
      const payload = request.postDataJSON() as Record<string, JsonBody>;
      const nextPayload = { ...payload };
      if ("metadata" in nextPayload) {
        nextPayload.metadata = {
          ...jsonRecord(obligations[0].metadata),
          ...jsonRecord(nextPayload.metadata),
        };
      }
      Object.assign(obligations[0], nextPayload);
      await fulfillJson(route, obligations[0]);
      return;
    }

    if (
      method === "POST" &&
      path === "/obligations/obligation-1/assignment-notification/send-email"
    ) {
      Object.assign(obligations[0], {
        metadata: assignmentNotificationMetadata(
          obligations[0].metadata,
          obligations[0].id,
        ),
      });
      await fulfillJson(route, obligations[0]);
      return;
    }

    if (method === "GET" && path === "/maintenance/work-orders") {
      await fulfillJson(route, maintenanceWorkOrders);
      return;
    }

    if (method === "GET" && path === "/maintenance/work-orders/work-order-1") {
      await fulfillJson(route, maintenanceWorkOrders[0]);
      return;
    }

    if (
      method === "POST" &&
      path ===
        "/maintenance/work-orders/work-order-1/contractor-delivery/send-sms"
    ) {
      const payload = request.postDataJSON() as {
        body?: string;
        include_comment?: boolean;
      };
      const body = (payload.body ?? "").trim();
      const timestamp = "2026-05-20T01:25:00.000Z";
      const existingDelivery = maintenanceWorkOrders[0].metadata
        .contractor_delivery as Record<string, JsonBody> | undefined;
      const existingSmsDelivery = existingDelivery?.sms as
        | Record<string, JsonBody>
        | undefined;
      const existingReceipts = Array.isArray(existingSmsDelivery?.receipts)
        ? existingSmsDelivery.receipts
        : [];
      const existingHistory = Array.isArray(existingSmsDelivery?.history)
        ? existingSmsDelivery.history
        : [];
      const retryCount = existingHistory.length + 1;
      const contractorDelivery = {
        ...(existingDelivery ?? {}),
        sms: {
          send: {
            status: "queued",
            provider: "twilio",
            attempted_at: timestamp,
            sent_at: timestamp,
            sent_by_user_id: operatorId,
            provider_message_id: "SM-maintenance-1",
            recipient_phone: "07 3000 1111",
            body,
            error: null,
            template_key: "maintenance_contractor_sms",
            template_version: "v1",
            retry_count: retryCount,
          },
          receipts: [
            {
              received_at: timestamp,
              channel: "sms",
              status: "queued",
              provider: "twilio",
              recipient_phone: "07 3000 1111",
              provider_message_id: "SM-maintenance-1",
              error: null,
              template_key: "maintenance_contractor_sms",
              template_version: "v1",
              retry_count: retryCount,
            },
            ...existingReceipts,
          ],
          history: [
            ...existingHistory,
            {
              event: "provider_delivery_attempted",
              at: timestamp,
              user_id: operatorId,
              provider: "twilio",
              status: "queued",
              recipient_phone: "07 3000 1111",
              provider_message_id: "SM-maintenance-1",
              error: null,
              template_key: "maintenance_contractor_sms",
              template_version: "v1",
              retry_count: retryCount,
            },
          ],
        },
      };
      const existingComments =
        (maintenanceWorkOrders[0].metadata.comments as
          | JsonBody[]
          | undefined) ?? [];
      const comments =
        payload.include_comment === false
          ? existingComments
          : [
              ...existingComments,
              {
                timestamp,
                actor: operatorId,
                visibility: "contractor",
                body,
              },
            ];
      const commentActivity =
        payload.include_comment === false
          ? []
          : [
              {
                timestamp,
                actor: operatorId,
                source: "operator_api",
                event: "comment_added",
                visibility: "contractor",
                summary: body,
              },
            ];
      const metadata = {
        ...maintenanceWorkOrders[0].metadata,
        comments,
        contractor_delivery: contractorDelivery,
        activity_history: [
          ...maintenanceWorkOrders[0].metadata.activity_history,
          ...commentActivity,
          {
            timestamp,
            actor: operatorId,
            source: "operator_api",
            event: "contractor_sms_attempted",
            summary: "Contractor SMS queued.",
            status: maintenanceWorkOrders[0].status,
          },
        ],
      };
      Object.assign(maintenanceWorkOrders[0], {
        metadata,
        updated_at: timestamp,
      });
      await fulfillJson(route, maintenanceWorkOrders[0]);
      return;
    }

    if (
      method === "POST" &&
      path ===
        "/maintenance/work-orders/work-order-1/contractor-delivery/send-email"
    ) {
      const payload = request.postDataJSON() as {
        body?: string;
        subject?: string | null;
        include_comment?: boolean;
      };
      const body = (payload.body ?? "").trim();
      const subject =
        payload.subject?.trim() || "Maintenance update: Air conditioning fault";
      const timestamp = "2026-05-20T01:20:00.000Z";
      const existingDelivery = maintenanceWorkOrders[0].metadata
        .contractor_delivery as Record<string, JsonBody> | undefined;
      const existingEmailDelivery = existingDelivery?.email as
        | Record<string, JsonBody>
        | undefined;
      const existingReceipts = Array.isArray(existingEmailDelivery?.receipts)
        ? existingEmailDelivery.receipts
        : [];
      const existingHistory = Array.isArray(existingEmailDelivery?.history)
        ? existingEmailDelivery.history
        : [];
      const retryCount = existingHistory.length + 1;
      const contractorDelivery = {
        ...(existingDelivery ?? {}),
        email: {
          send: {
            status: "queued",
            provider: "sendgrid",
            attempted_at: timestamp,
            sent_at: timestamp,
            sent_by_user_id: operatorId,
            provider_message_id: "sg-maintenance-1",
            recipient_email: "service@coolair.example",
            subject,
            body,
            error: null,
            template_key: "maintenance_contractor_update",
            template_version: "v1",
            retry_count: retryCount,
          },
          receipts: [
            {
              received_at: timestamp,
              channel: "email",
              status: "queued",
              provider: "sendgrid",
              recipient_email: "service@coolair.example",
              provider_message_id: "sg-maintenance-1",
              error: null,
              subject,
              template_key: "maintenance_contractor_update",
              template_version: "v1",
              retry_count: retryCount,
            },
            ...existingReceipts,
          ],
          history: [
            ...existingHistory,
            {
              event: "provider_delivery_attempted",
              at: timestamp,
              user_id: operatorId,
              provider: "sendgrid",
              status: "queued",
              recipient_email: "service@coolair.example",
              provider_message_id: "sg-maintenance-1",
              error: null,
              subject,
              template_key: "maintenance_contractor_update",
              template_version: "v1",
              retry_count: retryCount,
            },
          ],
        },
      };
      const existingComments =
        (maintenanceWorkOrders[0].metadata.comments as
          | JsonBody[]
          | undefined) ?? [];
      const comments =
        payload.include_comment === false
          ? existingComments
          : [
              ...existingComments,
              {
                timestamp,
                actor: operatorId,
                visibility: "contractor",
                body,
              },
            ];
      const commentActivity =
        payload.include_comment === false
          ? []
          : [
              {
                timestamp,
                actor: operatorId,
                source: "operator_api",
                event: "comment_added",
                visibility: "contractor",
                summary: body,
              },
            ];
      const metadata = {
        ...maintenanceWorkOrders[0].metadata,
        comments,
        contractor_delivery: contractorDelivery,
        activity_history: [
          ...maintenanceWorkOrders[0].metadata.activity_history,
          ...commentActivity,
          {
            timestamp,
            actor: operatorId,
            source: "operator_api",
            event: "contractor_email_attempted",
            summary: "Contractor email queued.",
            status: maintenanceWorkOrders[0].status,
          },
        ],
      };
      Object.assign(maintenanceWorkOrders[0], {
        metadata,
        updated_at: timestamp,
      });
      await fulfillJson(route, maintenanceWorkOrders[0]);
      return;
    }

    if (
      method === "POST" &&
      path ===
        "/maintenance/work-orders/work-order-1/assignment-notification/send-email"
    ) {
      Object.assign(maintenanceWorkOrders[0], {
        metadata: assignmentNotificationMetadata(
          maintenanceWorkOrders[0].metadata,
          maintenanceWorkOrders[0].id,
        ),
        updated_at: "2026-05-20T01:15:00.000Z",
      });
      await fulfillJson(route, maintenanceWorkOrders[0]);
      return;
    }

    if (
      method === "POST" &&
      path === "/maintenance/work-orders/work-order-1/comments"
    ) {
      const payload = request.postDataJSON() as {
        body?: string;
        visibility?: string;
      };
      const body = (payload.body ?? "").trim();
      const timestamp = "2026-05-20T01:15:00.000Z";
      const metadata = {
        ...maintenanceWorkOrders[0].metadata,
        comments: [
          ...((maintenanceWorkOrders[0].metadata.comments as
            | JsonBody[]
            | undefined) ?? []),
          {
            timestamp,
            actor: operatorId,
            visibility: payload.visibility ?? "internal",
            body,
          },
        ],
        activity_history: [
          ...maintenanceWorkOrders[0].metadata.activity_history,
          {
            timestamp,
            actor: operatorId,
            source: "operator_api",
            event: "comment_added",
            visibility: payload.visibility ?? "internal",
            summary: body,
          },
        ],
      };
      Object.assign(maintenanceWorkOrders[0], {
        metadata,
        updated_at: timestamp,
      });
      await fulfillJson(route, maintenanceWorkOrders[0]);
      return;
    }

    if (
      method === "PATCH" &&
      path === "/maintenance/work-orders/work-order-1"
    ) {
      const payload = request.postDataJSON() as Record<string, JsonBody>;
      const nextPayload = { ...payload };
      if ("metadata" in nextPayload) {
        nextPayload.metadata = {
          ...jsonRecord(maintenanceWorkOrders[0].metadata),
          ...jsonRecord(nextPayload.metadata),
        };
      }
      Object.assign(maintenanceWorkOrders[0], nextPayload, {
        updated_at: "2026-05-20T01:00:00.000Z",
      });
      await fulfillJson(route, maintenanceWorkOrders[0]);
      return;
    }

    if (method === "POST" && path === "/maintenance/work-orders") {
      const payload = request.postDataJSON() as Record<string, JsonBody>;
      const created = {
        ...maintenanceWorkOrders[0],
        ...payload,
        id: "work-order-created",
        requested_at: "2026-05-20T02:00:00.000Z",
        created_at: "2026-05-20T02:00:00.000Z",
        updated_at: "2026-05-20T02:00:00.000Z",
        document_ids: [],
        photo_document_ids: [],
        deleted_at: null,
      };
      maintenanceWorkOrders.unshift(created);
      await fulfillJson(route, created, 201);
      return;
    }

    if (method === "GET" && path === "/arrears/cases") {
      await fulfillJson(route, arrearsCases);
      return;
    }

    if (method === "PATCH" && path === "/arrears/cases/arrears-1") {
      const payload = request.postDataJSON() as Record<string, JsonBody>;
      const nextPayload = { ...payload };
      if ("metadata" in nextPayload) {
        nextPayload.metadata = {
          ...jsonRecord(arrearsCases[0].metadata),
          ...jsonRecord(nextPayload.metadata),
        };
      }
      Object.assign(arrearsCases[0], nextPayload, {
        updated_at: "2026-05-20T01:00:00.000Z",
      });
      await fulfillJson(route, arrearsCases[0]);
      return;
    }

    if (
      method === "POST" &&
      path === "/arrears/cases/arrears-1/assignment-notification/send-email"
    ) {
      Object.assign(arrearsCases[0], {
        metadata: assignmentNotificationMetadata(
          arrearsCases[0].metadata,
          arrearsCases[0].id,
        ),
        updated_at: "2026-05-20T01:15:00.000Z",
      });
      await fulfillJson(route, arrearsCases[0]);
      return;
    }

    if (method === "GET" && path === "/work-assignments/notification-center") {
      await fulfillJson(route, {
        entity_id: url.searchParams.get("entity_id") ?? entityId,
        generated_at: "2026-05-21T10:00:00.000Z",
        last_read_at: notificationCenterReadAt,
        unread_count: notificationCenterReadAt ? 0 : 3,
        notice_count: 2,
        attention_count: assignmentNoticeRetried ? 0 : 1,
        ready_count: 0,
        in_flight_count: assignmentNoticeRetried ? 2 : 1,
        done_count: 0,
        digest_receipt_count: 1,
        guardrails: [
          "Notification center is read-only; sending still requires explicit operator action.",
          "Digest receipts are preview receipts unless message_sent is true.",
        ],
        channels: [
          {
            channel: "email",
            provider: "sendgrid",
            label: "Email",
            readiness: "actionable",
            reason_code: "sendgrid_not_configured",
            configured: false,
            action_available: true,
            detail:
              "Email actions are available, but SendGrid is not fully configured.",
            next_action:
              "Configure SendGrid to queue provider emails instead of skipped receipts.",
            setup_checks: [
              {
                key: "work_assignment_email_enabled",
                label: "Work email toggle",
                status: "ready",
                detail: "Work assignment email delivery is enabled.",
                value: null,
              },
              {
                key: "sendgrid_sender",
                label: "SendGrid sender",
                status: "missing",
                detail:
                  "Add SendGrid API key and sender email environment variables.",
                value: null,
              },
              {
                key: "sendgrid_event_webhook",
                label: "SendGrid event webhook",
                status: "review",
                detail:
                  "Use this endpoint in SendGrid Event Webhook and configure the shared webhook secret outside Leasium.",
                value:
                  "https://api.leasium.test/api/v1/work-assignments/webhooks/sendgrid-events",
              },
            ],
          },
          {
            channel: "sms",
            provider: "twilio",
            label: "SMS",
            readiness: "actionable",
            reason_code: "twilio_not_configured",
            configured: false,
            action_available: true,
            detail:
              "SMS actions are available, but Twilio is not fully configured.",
            next_action:
              "Configure Twilio to queue provider SMS instead of skipped receipts.",
            setup_checks: [
              {
                key: "operator_sms_preferences",
                label: "Operator SMS preferences",
                status: "ready",
                detail: "1 active operator SMS recipient configured.",
                value: null,
              },
              {
                key: "twilio_messaging",
                label: "Twilio Messaging",
                status: "missing",
                detail:
                  "Add Twilio credentials and a sender number or messaging service.",
                value: null,
              },
              {
                key: "twilio_status_callback",
                label: "Twilio status callback",
                status: "review",
                detail:
                  "Use this endpoint for Work SMS status callbacks and configure the shared webhook secret outside Leasium.",
                value:
                  "https://api.leasium.test/api/v1/work-assignments/webhooks/twilio-status",
              },
            ],
          },
          {
            channel: "in_app",
            provider: "leasium",
            label: "In-app",
            readiness: "read_only",
            reason_code: "in_app_read_only",
            configured: true,
            action_available: false,
            detail:
              "In-app assignment receipts are recorded on work items and shown read-only here.",
            next_action:
              "Use Work assignment controls to update ownership and follow-up state.",
            setup_checks: [
              {
                key: "leasium_receipts",
                label: "Leasium receipts",
                status: "ready",
                detail:
                  "In-app assignment receipts are stored in Leasium work metadata.",
                value: null,
              },
            ],
          },
        ],
        notices: [
          {
            target_id: "work-order-1",
            target_type: "maintenance_work_order",
            title: "Air conditioning fault",
            summary: "Assignment notification email was queued.",
            assignee_user_id: assigneeId,
            assignee_name: "Temba van Jaarsveld",
            assignee_email: "temba@example.com",
            group: "in_flight",
            notification_status: "queued",
            notification_detail: "Assignment email was queued by SendGrid.",
            channel: "email",
            provider: "sendgrid",
            template_key: "work_assignment_notification",
            template_version: "v1",
            due_date: "2026-05-20",
            event_at: "2026-05-20T01:15:00.000Z",
            follow_up_due: false,
            work_url: "/operations/maintenance/work-order-1",
            provider_history: [
              {
                event: "provider_notification_attempted",
                channel: "email",
                status: "queued",
                raw_event: null,
                provider: "sendgrid",
                attempted_at: "2026-05-20T01:15:00.000Z",
                received_at: null,
                recipient_email: "temba@example.com",
                recipient_phone: null,
                provider_message_id: "sg-notice-smoke-1",
                error: null,
                template_key: "work_assignment_notification",
                template_version: "v1",
                delivery_trigger: null,
                recovery_of_generated_at: null,
                delivery_attempt_count: 1,
              },
            ],
            sms_action_available: true,
            sms_status: null,
            sms_detail: null,
            sms_provider: null,
            sms_recipient_phone: null,
            sms_provider_message_id: null,
            sms_attempt_count: 0,
            sms_provider_history: [],
            channel_receipts: [
              noticeChannelReceipt({
                channel: "email",
                label: "Email",
                provider: "sendgrid",
                status: "queued",
                detail: "Assignment email was queued by SendGrid.",
                recipient_email: "temba@example.com",
                provider_message_id: "sg-notice-smoke-1",
                template_key: "work_assignment_notification",
                template_version: "v1",
                attempted_at: "2026-05-20T01:15:00.000Z",
                delivery_attempt_count: 1,
                message_sent: true,
                rendered_message_preview: workNoticeEmailPreview(
                  "Air conditioning fault",
                ),
                provider_history: [
                  {
                    event: "provider_notification_attempted",
                    channel: "email",
                    status: "queued",
                    raw_event: null,
                    provider: "sendgrid",
                    attempted_at: "2026-05-20T01:15:00.000Z",
                    received_at: null,
                    recipient_email: "temba@example.com",
                    recipient_phone: null,
                    provider_message_id: "sg-notice-smoke-1",
                    error: null,
                    template_key: "work_assignment_notification",
                    template_version: "v1",
                    delivery_trigger: null,
                    recovery_of_generated_at: null,
                    delivery_attempt_count: 1,
                  },
                ],
              }),
              noticeChannelReceipt({
                channel: "sms",
                label: "SMS",
                provider: "twilio",
                action_available: true,
              }),
            ],
          },
          {
            target_id: "arrears-1",
            target_type: "arrears_case",
            title: "Bright Cafe arrears",
            summary: assignmentNoticeRetried
              ? "Assignment notification email was queued."
              : "Assignment notification email failed.",
            assignee_user_id: assigneeId,
            assignee_name: "Temba van Jaarsveld",
            assignee_email: "temba@example.com",
            group: assignmentNoticeRetried ? "in_flight" : "attention",
            notification_status: assignmentNoticeRetried ? "queued" : "failed",
            notification_detail: assignmentNoticeRetried
              ? "Assignment email was queued by SendGrid."
              : "SendGrid returned 500.",
            channel: "email",
            provider: "sendgrid",
            template_key: "work_assignment_notification",
            template_version: "v1",
            due_date: "2026-05-18",
            event_at: "2026-05-20T00:30:00.000Z",
            follow_up_due: true,
            work_url: "/operations",
            provider_history: [
              ...(assignmentNoticeRetried
                ? [
                    {
                      event: "provider_notification_attempted",
                      channel: "email",
                      status: "queued",
                      raw_event: null,
                      provider: "sendgrid",
                      attempted_at: "2026-05-21T10:10:00.000Z",
                      received_at: null,
                      recipient_email: "temba@example.com",
                      recipient_phone: null,
                      provider_message_id: "sg-notice-smoke-retry",
                      error: null,
                      template_key: "work_assignment_notification",
                      template_version: "v1",
                      delivery_trigger: null,
                      recovery_of_generated_at: null,
                      delivery_attempt_count: 2,
                    },
                  ]
                : []),
              {
                event: "provider_notification_attempted",
                channel: "email",
                status: "failed",
                raw_event: null,
                provider: "sendgrid",
                attempted_at: "2026-05-20T00:30:00.000Z",
                received_at: null,
                recipient_email: "temba@example.com",
                recipient_phone: null,
                provider_message_id: "sg-notice-smoke-2",
                error: "SendGrid returned 500.",
                template_key: "work_assignment_notification",
                template_version: "v1",
                delivery_trigger: null,
                recovery_of_generated_at: null,
                delivery_attempt_count: 1,
              },
            ],
            sms_action_available: true,
            sms_status: assignmentNoticeSmsSent ? "skipped" : null,
            sms_detail: assignmentNoticeSmsSent
              ? "Twilio Messaging is not configured."
              : null,
            sms_provider: assignmentNoticeSmsSent ? "twilio" : null,
            sms_recipient_phone: assignmentNoticeSmsSent
              ? "+61400111222"
              : null,
            sms_provider_message_id: null,
            sms_attempt_count: assignmentNoticeSmsSent ? 1 : 0,
            sms_provider_history: assignmentNoticeSmsSent
              ? [
                  {
                    event: "provider_notification_attempted",
                    channel: "sms",
                    status: "skipped",
                    raw_event: null,
                    provider: "twilio",
                    attempted_at: "2026-05-21T10:12:00.000Z",
                    received_at: null,
                    recipient_email: null,
                    recipient_phone: "+61400111222",
                    provider_message_id: null,
                    error: "Twilio Messaging is not configured.",
                    template_key: "work_assignment_notification",
                    template_version: "v1",
                    delivery_trigger: "manual",
                    recovery_of_generated_at: null,
                    delivery_attempt_count: 1,
                  },
                ]
              : [],
            channel_receipts: [
              noticeChannelReceipt({
                channel: "email",
                label: "Email",
                provider: "sendgrid",
                status: assignmentNoticeRetried ? "queued" : "failed",
                detail: assignmentNoticeRetried
                  ? "Assignment email was queued by SendGrid."
                  : "SendGrid returned 500.",
                recipient_email: "temba@example.com",
                provider_message_id: assignmentNoticeRetried
                  ? "sg-notice-smoke-retry"
                  : "sg-notice-smoke-2",
                template_key: "work_assignment_notification",
                template_version: "v1",
                attempted_at: assignmentNoticeRetried
                  ? "2026-05-21T10:10:00.000Z"
                  : "2026-05-20T00:30:00.000Z",
                delivery_attempt_count: assignmentNoticeRetried ? 2 : 1,
                message_sent: assignmentNoticeRetried,
                action_available: !assignmentNoticeRetried,
                rendered_message_preview: workNoticeEmailPreview(
                  "Bright Cafe arrears",
                ),
              }),
              noticeChannelReceipt({
                channel: "sms",
                label: "SMS",
                provider: "twilio",
                status: assignmentNoticeSmsSent ? "skipped" : null,
                detail: assignmentNoticeSmsSent
                  ? "Twilio Messaging is not configured."
                  : null,
                recipient_phone: assignmentNoticeSmsSent
                  ? "+61400111222"
                  : null,
                attempted_at: assignmentNoticeSmsSent
                  ? "2026-05-21T10:12:00.000Z"
                  : null,
                delivery_attempt_count: assignmentNoticeSmsSent ? 1 : 0,
                action_available: true,
                rendered_message_preview: assignmentNoticeSmsSent
                  ? workNoticeSmsPreview("Bright Cafe arrears")
                  : null,
                provider_history: assignmentNoticeSmsSent
                  ? [
                      {
                        event: "provider_notification_attempted",
                        channel: "sms",
                        status: "skipped",
                        raw_event: null,
                        provider: "twilio",
                        attempted_at: "2026-05-21T10:12:00.000Z",
                        received_at: null,
                        recipient_email: null,
                        recipient_phone: "+61400111222",
                        provider_message_id: null,
                        error: "Twilio Messaging is not configured.",
                        template_key: "work_assignment_notification",
                        template_version: "v1",
                        delivery_trigger: "manual",
                        recovery_of_generated_at: null,
                        delivery_attempt_count: 1,
                      },
                    ]
                  : [],
              }),
            ],
          },
        ],
        digest_receipts: [
          {
            assignee_user_id: operatorId,
            assignee_name: "Owner Operator",
            assignee_email: "owner@example.com",
            generated_at: "2026-05-21T09:00:00.000Z",
            cadence: "daily",
            item_count: 4,
            follow_up_due_count: 2,
            delivery_status: digestReceiptSent ? "queued" : "previewed",
            message_sent: digestReceiptSent,
            delivery_detail: digestReceiptSent
              ? "Digest email was queued by SendGrid."
              : null,
            delivery_channel: digestReceiptSent ? "email" : null,
            provider: digestReceiptSent ? "sendgrid" : null,
            provider_message_id: digestReceiptSent
              ? "sg-digest-smoke-retry"
              : null,
            template_key: "work_assignment_digest",
            template_version: "v1",
            delivery_trigger: digestReceiptSent ? "recovery" : "preview",
            recovery_of_generated_at: digestReceiptSent
              ? "2026-05-21T09:00:00.000Z"
              : null,
            delivery_attempt_count: digestReceiptSent ? 1 : 0,
            rendered_message_preview: workDigestMessagePreview(),
            provider_history: digestReceiptSent
              ? [
                  {
                    event: "digest_delivery_attempted",
                    channel: "email",
                    status: "queued",
                    raw_event: null,
                    provider: "sendgrid",
                    attempted_at: "2026-05-21T10:00:00.000Z",
                    received_at: null,
                    recipient_email: "owner@example.com",
                    recipient_phone: null,
                    provider_message_id: "sg-digest-smoke-retry",
                    error: null,
                    template_key: "work_assignment_digest",
                    template_version: "v1",
                    delivery_trigger: "recovery",
                    recovery_of_generated_at: "2026-05-21T09:00:00.000Z",
                    delivery_attempt_count: 1,
                  },
                ]
              : [],
            channel_receipts: [
              {
                channel: "email",
                label: "Work digest email",
                provider: digestReceiptSent ? "sendgrid" : null,
                status: digestReceiptSent ? "queued" : "previewed",
                detail: digestReceiptSent
                  ? "Digest email was queued by SendGrid."
                  : null,
                recipient_email: "owner@example.com",
                recipient_phone: null,
                provider_message_id: digestReceiptSent
                  ? "sg-digest-smoke-retry"
                  : null,
                template_key: "work_assignment_digest",
                template_version: "v1",
                attempted_at: digestReceiptSent
                  ? "2026-05-21T10:00:00.000Z"
                  : null,
                sent_at: null,
                receipt_at: null,
                last_event: null,
                delivery_trigger: digestReceiptSent ? "recovery" : "preview",
                delivery_attempt_count: digestReceiptSent ? 1 : 0,
                message_sent: digestReceiptSent,
                action_available: false,
                provider_history: digestReceiptSent
                  ? [
                      {
                        event: "digest_delivery_attempted",
                        channel: "email",
                        status: "queued",
                        raw_event: null,
                        provider: "sendgrid",
                        attempted_at: "2026-05-21T10:00:00.000Z",
                        received_at: null,
                        recipient_email: "owner@example.com",
                        recipient_phone: null,
                        provider_message_id: "sg-digest-smoke-retry",
                        error: null,
                        template_key: "work_assignment_digest",
                        template_version: "v1",
                        delivery_trigger: "recovery",
                        recovery_of_generated_at: "2026-05-21T09:00:00.000Z",
                        delivery_attempt_count: 1,
                      },
                    ]
                  : [],
                rendered_message_preview: workDigestMessagePreview(),
              },
            ],
          },
        ],
      });
      return;
    }

    if (
      method === "GET" &&
      path === "/work-assignments/notification-templates"
    ) {
      await fulfillJson(route, {
        guardrails: [
          "Template choices only set reviewed SendGrid metadata; they do not send messages.",
          "Operator email and digest sends still require the existing explicit approval actions.",
        ],
        notice_templates: [
          {
            kind: "assignment_notice",
            key: "work_assignment_notification",
            name: "Standard assignment notice",
            default_version: "v1",
            channel: "email",
            provider: "sendgrid",
            subject_preview: "New Leasium work assigned",
            content_summary:
              "Includes the work title, due date, source workspace, and a link back to Leasium.",
            recovery_summary:
              "Use for normal assignment sends and retries from Work.",
            is_system: true,
          },
          {
            kind: "assignment_notice",
            key: "work_assignment_follow_up",
            name: "Follow-up assignment notice",
            default_version: "v1",
            channel: "email",
            provider: "sendgrid",
            subject_preview: "Leasium work follow-up needed",
            content_summary:
              "Emphasises due reminders, escalation watch dates, and the assigned operator.",
            recovery_summary:
              "Use when reminder or escalation cues are the reason for the send.",
            is_system: true,
          },
        ],
        digest_templates: [
          {
            kind: "digest",
            key: "work_assignment_digest",
            name: "Standard work digest",
            default_version: "v1",
            channel: "email",
            provider: "sendgrid",
            subject_preview: "Leasium daily or weekly Work digest",
            content_summary:
              "Groups assigned work by urgency, follow-up status, and source workspace.",
            recovery_summary:
              "Use for normal daily and weekly digest previews, sends, and retries.",
            is_system: true,
          },
          {
            kind: "digest",
            key: "work_assignment_digest_owner_review",
            name: "Owner review digest",
            default_version: "v1",
            channel: "email",
            provider: "sendgrid",
            subject_preview: "Leasium owner review digest",
            content_summary:
              "Highlights owner-facing review items, approvals, blockers, and overdue follow-ups.",
            recovery_summary:
              "Use for operators who need a higher-level review summary.",
            is_system: true,
          },
        ],
      });
      return;
    }

    if (
      method === "GET" &&
      path === "/branded-communication-templates"
    ) {
      await fulfillJson(route, brandedCommunicationTemplates);
      return;
    }

    if (
      method === "POST" &&
      path === "/work-assignments/notification-center/notices/send-email"
    ) {
      const payload = request.postDataJSON() as {
        entity_id?: string;
        target_id?: string;
        target_type?: "maintenance_work_order" | "arrears_case" | "obligation";
        delivery_trigger?: "manual" | "retry";
      };
      assignmentNoticeRetried = true;
      await fulfillJson(route, {
        entity_id: payload.entity_id ?? entityId,
        target_type: payload.target_type ?? "arrears_case",
        target_id: payload.target_id ?? "arrears-1",
        status: "queued",
        message_sent: true,
        recipient_email: "temba@example.com",
        provider: "sendgrid",
        provider_message_id: "sg-notice-smoke-retry",
        detail: "Assignment email was queued by SendGrid.",
        template_key: "work_assignment_notification",
        template_version: "v1",
        attempted_at: "2026-05-21T10:10:00.000Z",
        delivery_trigger: payload.delivery_trigger ?? "retry",
        notice: {
          target_id: payload.target_id ?? "arrears-1",
          target_type: payload.target_type ?? "arrears_case",
          title: "Bright Cafe arrears",
          summary: "Assignment notification email was queued.",
          assignee_user_id: assigneeId,
          assignee_name: "Temba van Jaarsveld",
          assignee_email: "temba@example.com",
          group: "in_flight",
          notification_status: "queued",
          notification_detail: "Assignment email was queued by SendGrid.",
          channel: "email",
          provider: "sendgrid",
          template_key: "work_assignment_notification",
          template_version: "v1",
          due_date: "2026-05-18",
          event_at: "2026-05-21T10:10:00.000Z",
          follow_up_due: true,
          work_url: "/operations",
          provider_history: [],
          sms_action_available: true,
          sms_status: null,
          sms_detail: null,
          sms_provider: null,
          sms_recipient_phone: null,
          sms_provider_message_id: null,
          sms_attempt_count: 0,
          sms_provider_history: [],
          channel_receipts: [
            noticeChannelReceipt({
              channel: "email",
              label: "Email",
              provider: "sendgrid",
              status: "queued",
              detail: "Assignment email was queued by SendGrid.",
              recipient_email: "temba@example.com",
              provider_message_id: "sg-notice-smoke-retry",
              template_key: "work_assignment_notification",
              template_version: "v1",
              attempted_at: "2026-05-21T10:10:00.000Z",
              delivery_attempt_count: 2,
              message_sent: true,
              rendered_message_preview: workNoticeEmailPreview(
                "Bright Cafe arrears",
              ),
            }),
            noticeChannelReceipt({
              channel: "sms",
              label: "SMS",
              provider: "twilio",
              action_available: true,
            }),
          ],
        },
      });
      return;
    }

    if (
      method === "POST" &&
      path === "/work-assignments/notification-center/notices/send-sms"
    ) {
      const payload = request.postDataJSON() as {
        entity_id?: string;
        target_id?: string;
        target_type?: "maintenance_work_order" | "arrears_case" | "obligation";
        delivery_trigger?: "manual" | "retry";
      };
      assignmentNoticeSmsSent = true;
      await fulfillJson(route, {
        entity_id: payload.entity_id ?? entityId,
        target_type: payload.target_type ?? "arrears_case",
        target_id: payload.target_id ?? "arrears-1",
        status: "skipped",
        message_sent: false,
        recipient_phone: "+61400111222",
        provider: "twilio",
        provider_message_id: null,
        detail: "Twilio Messaging is not configured.",
        template_key: "work_assignment_notification",
        template_version: "v1",
        attempted_at: "2026-05-21T10:12:00.000Z",
        delivery_trigger: payload.delivery_trigger ?? "manual",
        notice: {
          target_id: payload.target_id ?? "arrears-1",
          target_type: payload.target_type ?? "arrears_case",
          title: "Bright Cafe arrears",
          summary: assignmentNoticeRetried
            ? "Assignment notification email was queued."
            : "Assignment notification email failed.",
          assignee_user_id: assigneeId,
          assignee_name: "Temba van Jaarsveld",
          assignee_email: "temba@example.com",
          group: assignmentNoticeRetried ? "in_flight" : "attention",
          notification_status: assignmentNoticeRetried ? "queued" : "failed",
          notification_detail: assignmentNoticeRetried
            ? "Assignment email was queued by SendGrid."
            : "SendGrid returned 500.",
          channel: "email",
          provider: "sendgrid",
          template_key: "work_assignment_notification",
          template_version: "v1",
          due_date: "2026-05-18",
          event_at: "2026-05-21T10:12:00.000Z",
          follow_up_due: true,
          work_url: "/operations",
          provider_history: [],
          sms_action_available: true,
          sms_status: "skipped",
          sms_detail: "Twilio Messaging is not configured.",
          sms_provider: "twilio",
          sms_recipient_phone: "+61400111222",
          sms_provider_message_id: null,
          sms_attempt_count: 1,
          sms_provider_history: [
            {
              event: "provider_notification_attempted",
              channel: "sms",
              status: "skipped",
              raw_event: null,
              provider: "twilio",
              attempted_at: "2026-05-21T10:12:00.000Z",
              received_at: null,
              recipient_email: null,
              recipient_phone: "+61400111222",
              provider_message_id: null,
              error: "Twilio Messaging is not configured.",
              template_key: "work_assignment_notification",
              template_version: "v1",
              delivery_trigger: payload.delivery_trigger ?? "manual",
              recovery_of_generated_at: null,
              delivery_attempt_count: 1,
            },
          ],
          channel_receipts: [
            noticeChannelReceipt({
              channel: "email",
              label: "Email",
              provider: "sendgrid",
              status: assignmentNoticeRetried ? "queued" : "failed",
              detail: assignmentNoticeRetried
                ? "Assignment email was queued by SendGrid."
                : "SendGrid returned 500.",
              recipient_email: "temba@example.com",
              provider_message_id: assignmentNoticeRetried
                ? "sg-notice-smoke-retry"
                : "sg-notice-smoke-2",
              template_key: "work_assignment_notification",
              template_version: "v1",
              attempted_at: assignmentNoticeRetried
                ? "2026-05-21T10:10:00.000Z"
                : "2026-05-20T00:30:00.000Z",
              delivery_attempt_count: assignmentNoticeRetried ? 2 : 1,
              message_sent: assignmentNoticeRetried,
              action_available: !assignmentNoticeRetried,
              rendered_message_preview: workNoticeEmailPreview(
                "Bright Cafe arrears",
              ),
            }),
            noticeChannelReceipt({
              channel: "sms",
              label: "SMS",
              provider: "twilio",
              status: "skipped",
              detail: "Twilio Messaging is not configured.",
              recipient_phone: "+61400111222",
              attempted_at: "2026-05-21T10:12:00.000Z",
              delivery_trigger: payload.delivery_trigger ?? "manual",
              delivery_attempt_count: 1,
              action_available: true,
              rendered_message_preview: workNoticeSmsPreview(
                "Bright Cafe arrears",
              ),
              provider_history: [
                {
                  event: "provider_notification_attempted",
                  channel: "sms",
                  status: "skipped",
                  raw_event: null,
                  provider: "twilio",
                  attempted_at: "2026-05-21T10:12:00.000Z",
                  received_at: null,
                  recipient_email: null,
                  recipient_phone: "+61400111222",
                  provider_message_id: null,
                  error: "Twilio Messaging is not configured.",
                  template_key: "work_assignment_notification",
                  template_version: "v1",
                  delivery_trigger: payload.delivery_trigger ?? "manual",
                  recovery_of_generated_at: null,
                  delivery_attempt_count: 1,
                },
              ],
            }),
          ],
        },
      });
      return;
    }

    if (
      method === "POST" &&
      path === "/work-assignments/notification-center/mark-read"
    ) {
      notificationCenterReadAt = "2026-05-21T10:05:00.000Z";
      await fulfillJson(route, {
        entity_id: url.searchParams.get("entity_id") ?? entityId,
        read_at: notificationCenterReadAt,
        unread_count: 0,
      });
      return;
    }

    if (method === "POST" && path === "/work-assignments/digests/run") {
      const payload = request.postDataJSON() as {
        entity_id?: string;
        cadence?: "daily" | "weekly";
        send_email_approved?: boolean;
        delivery_trigger?: "manual" | "scheduled" | "recovery";
        recovery_of_generated_at?: string | null;
      };
      const sendApproved = payload.send_email_approved === true;
      if (sendApproved) {
        digestReceiptSent = true;
      }
      await fulfillJson(route, {
        entity_id: payload.entity_id ?? entityId,
        cadence: payload.cadence ?? "daily",
        generated_at: "2026-05-21T02:30:00.000Z",
        operator_count: 1,
        work_item_count: 1,
        guardrails: [
          sendApproved
            ? "Digest email delivery only runs when send_email_approved is explicitly true."
            : "Digest generation is review-only; it does not send email, SMS, or push notifications.",
        ],
        digests: [
          {
            assignee_user_id: assigneeId,
            assignee_name: "Temba van Jaarsveld",
            assignee_email: "temba@example.com",
            cadence: payload.cadence ?? "daily",
            item_count: 1,
            ready_count: 0,
            attention_count: 0,
            in_flight_count: 1,
            done_count: 0,
            follow_up_due_count: 0,
            delivery_status: sendApproved ? "queued" : "previewed",
            message_sent: sendApproved,
            delivery_detail: sendApproved
              ? "Digest email was queued by SendGrid."
              : null,
            provider_message_id: sendApproved ? "sg-digest-smoke-1" : null,
            delivery_trigger: sendApproved
              ? (payload.delivery_trigger ?? "manual")
              : "preview",
            recovery_of_generated_at: payload.recovery_of_generated_at ?? null,
            delivery_attempt_count: sendApproved ? 1 : 0,
            rendered_message_preview: workDigestMessagePreview(),
            items: [
              {
                target_id: "work-order-1",
                target_type: "maintenance_work_order",
                title: "Air conditioning fault",
                description: "Tenant says the unit is not cooling.",
                due_date: "2026-05-21",
                status: "requested",
                priority: "urgent",
                notification_status: "queued",
                notification_group: "in_flight",
                notification_detail: "Assignment email was queued by SendGrid.",
                reminder_due_on: null,
                escalation_due_on: "2026-05-22",
                follow_up_due: false,
                work_url: "/operations/maintenance/work-order-1",
              },
            ],
          },
        ],
      });
      return;
    }

    if (method === "POST" && path === "/arrears/cases") {
      const payload = request.postDataJSON() as Record<string, JsonBody>;
      const total =
        Number(payload.balance_current_cents ?? 0) +
        Number(payload.balance_1_30_cents ?? 0) +
        Number(payload.balance_31_60_cents ?? 0) +
        Number(payload.balance_61_90_cents ?? 0) +
        Number(payload.balance_90_plus_cents ?? 0);
      const created = {
        ...arrearsCases[0],
        ...payload,
        id: "arrears-created",
        total_balance_cents: total,
        created_at: "2026-05-20T02:00:00.000Z",
        updated_at: "2026-05-20T02:00:00.000Z",
        deleted_at: null,
      };
      arrearsCases.unshift(created);
      await fulfillJson(route, created, 201);
      return;
    }

    if (method === "GET" && path === "/rent-roll") {
      await fulfillJson(route, rentRoll);
      return;
    }

    if (method === "GET" && path === "/billing-drafts") {
      await fulfillJson(route, billingDrafts);
      return;
    }

    if (method === "POST" && path === "/billing-drafts/from-charge-rules") {
      const payload = request.postDataJSON() as {
        entity_id?: string;
        lease_ids?: string[];
      };
      const leaseIds = payload.lease_ids ?? [];
      const existingLeaseIds = new Set(
        billingDrafts.map((draft) => draft.lease_id),
      );
      const createdDrafts = leaseIds
        .filter((leaseId) => !existingLeaseIds.has(leaseId))
        .map((leaseId, index) => {
          const row = rentRoll.find((item) => item.lease_id === leaseId);
          return {
            ...billingDrafts[0],
            id: `billing-draft-created-${index + 1}`,
            property_id: row?.property_id ?? propertyId,
            tenancy_unit_id: row?.tenancy_unit_id ?? unitId,
            tenant_id: row?.tenant_id ?? tenantId,
            lease_id: leaseId,
            status: "draft",
            title: `${row?.tenant_name ?? "Tenant"} draft charges`,
            total_cents: row?.charge_rules_total_cents ?? 0,
            metadata: { source: "charge_rules" },
            lines: [],
            created_at: "2026-05-21T00:15:00.000Z",
            updated_at: "2026-05-21T00:15:00.000Z",
          } as (typeof billingDrafts)[number];
        });
      billingDrafts.push(...createdDrafts);
      await fulfillJson(route, {
        entity_id: payload.entity_id ?? entityId,
        created: createdDrafts.length,
        existing: leaseIds.length - createdDrafts.length,
        skipped: 0,
        drafts: createdDrafts,
        skipped_rows: [],
      });
      return;
    }

    if (method === "GET" && path === "/invoice-drafts") {
      await fulfillJson(route, localInvoiceDrafts);
      return;
    }

    if (method === "GET" && path === "/owners/statements") {
      await fulfillJson(
        route,
        ownerStatements(url.searchParams.get("month") ?? "2026-05"),
      );
      return;
    }

    if (method === "GET" && path === "/document-intakes") {
      await fulfillJson(route, documentIntakes);
      return;
    }

    if (method === "GET" && path === "/documents") {
      await fulfillJson(route, operatorDocumentRecords());
      return;
    }

    if (method === "POST" && path === "/documents") {
      const body = request.postDataBuffer()?.toString("utf8") ?? "";
      const uploaded = {
        id: `operator-document-upload-${++tenantPortalDocumentCount}`,
        lease_id: multipartField(body, "lease_id"),
        tenant_onboarding_id: multipartField(body, "tenant_onboarding_id"),
        filename: multipartFilename(body),
        content_type: request
          .headers()
          ["content-type"]?.includes("multipart/form-data")
          ? null
          : (request.headers()["content-type"] ?? null),
        byte_size: request.postDataBuffer()?.byteLength ?? 0,
        category: multipartField(body, "category") ?? "other",
        notes: multipartField(body, "notes"),
        source: "operator_upload",
        created_at: "2026-05-20T03:30:00.000Z",
      };
      tenantPortalDocuments.unshift(uploaded);
      await fulfillJson(route, operatorDocumentRecords()[0], 201);
      return;
    }

    if (method === "GET" && path === "/tenancy-units") {
      await fulfillJson(route, tenancyUnits);
      return;
    }

    if (method === "GET" && path === "/leases") {
      await fulfillJson(route, leases);
      return;
    }

    if (method === "GET" && path === "/charge-rules") {
      await fulfillJson(route, rentRoll[0].charge_rules);
      return;
    }

    if (method === "PATCH" && path === "/charge-rules/charge-1") {
      const payload = request.postDataJSON() as {
        xero_account_code?: string | null;
        xero_tax_type?: string | null;
      };
      chargeAccountCode = payload.xero_account_code ?? chargeAccountCode;
      chargeTaxType = payload.xero_tax_type ?? chargeTaxType;
      await fulfillJson(route, {
        ...rentRoll[0].charge_rules[0],
        xero_account_code: chargeAccountCode,
        xero_tax_type: chargeTaxType,
      });
      return;
    }

    await fulfillJson(
      route,
      {
        detail: `Unhandled smoke mock: ${method} ${url.pathname}${url.search}`,
      },
      404,
    );
  });
}
