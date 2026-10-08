# Overlay on the published SDK. Default remains single-tenant unless PM4ML_MULTI_TENANT=true.
FROM mojaloop/sdk-scheme-adapter:v24.9.0

USER root
COPY overlay/modules/api-svc/src/ /opt/app/modules/api-svc/src/
RUN chown -R ml-user:ml-user /opt/app/modules/api-svc/src
USER ml-user

CMD ["yarn", "start:api-svc"]
